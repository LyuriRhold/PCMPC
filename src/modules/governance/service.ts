import Decimal from "decimal.js";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { businessToday, isBusinessDate, type BusinessDate } from "@/lib/dates";
import { members } from "@/modules/members/schema";
import { COMMITTEES, officers, trainingAttendees, trainings, type Committee } from "./schema";

/**
 * Officers, committees and trainings (PHASE-16 T16.1): the governance records the CDA annual
 * report lists (officers and their terms, trainings attended). Members are picked by member no.
 */

/** A governance rule was broken; the message is safe to show. */
export class GovernanceError extends Error {
  override name = "GovernanceError";
}

export const COMMITTEE_NAMES: Record<Committee, string> = {
  BOARD: "Board of Directors",
  AUDIT: "Audit Committee",
  ELECTION: "Election Committee",
  MEDIATION_CONCILIATION: "Mediation and Conciliation Committee",
  ETHICS: "Ethics Committee",
  CREDIT: "Credit Committee",
  EDUCATION_TRAINING: "Education and Training Committee",
  GENDER_DEVELOPMENT: "Gender and Development Committee",
  MANAGEMENT: "Management",
};

const name = (m: { lastName: string; firstName: string; middleName: string | null }) => [m.lastName, [m.firstName, m.middleName].filter(Boolean).join(" ")].join(", ");

/** Approved members by member no.; unknown numbers are listed in the error. */
async function membersByNo(tx: Tx, memberNos: string[]) {
  const wanted = [...new Set(memberNos.map((n) => n.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const found = await tx.select().from(members).where(inArray(members.memberNo, wanted));
  const missing = wanted.filter((n) => !found.some((m) => m.memberNo === n));
  if (missing.length) throw new GovernanceError(`No member with no. ${missing.join(", ")}`);
  const notMembers = found.filter((m) => m.status !== "ACTIVE" && m.status !== "INACTIVE");
  if (notMembers.length) throw new GovernanceError(`${notMembers.map((m) => m.memberNo).join(", ")} ${notMembers.length === 1 ? "is" : "are"} not an active member`);
  return found;
}

function assertDate(value: string | null | undefined, what: string): void {
  if (value && !isBusinessDate(value)) throw new GovernanceError(`Enter the ${what} as a date`);
}

export type OfficerInput = { memberNo: string; position: string; committee: string; termStart: BusinessDate; termEnd: BusinessDate | null; electedAtGa: BusinessDate | null };

/** Records an officer or committee member and their term. */
export async function addOfficer(tx: Tx, input: OfficerInput, actorId: string) {
  const position = input.position.trim();
  if (!position) throw new GovernanceError("Enter the position");
  if (!(COMMITTEES as readonly string[]).includes(input.committee)) throw new GovernanceError("Choose the board or committee");
  assertDate(input.termStart, "start of the term");
  assertDate(input.termEnd, "end of the term");
  assertDate(input.electedAtGa, "General Assembly date");
  if (!input.termStart) throw new GovernanceError("Enter the start of the term");
  if (input.termEnd && input.termEnd < input.termStart) throw new GovernanceError("The term ends on or after it starts");
  if (input.electedAtGa && input.electedAtGa > businessToday()) throw new GovernanceError("The General Assembly date can't be in the future");
  const [m] = await membersByNo(tx, [input.memberNo]);
  if (!m) throw new GovernanceError("Enter the member no.");
  const [same] = await tx
    .select({ id: officers.id })
    .from(officers)
    .where(
      and(
        eq(officers.memberId, m.id),
        eq(officers.committee, input.committee as Committee),
        sql`lower(${officers.position}) = lower(${position})`,
        or(isNull(officers.termEnd), gte(officers.termEnd, input.termStart)),
        input.termEnd ? lte(officers.termStart, input.termEnd) : undefined,
      ),
    );
  if (same) throw new GovernanceError(`${m.memberNo} already holds that position for part of that term`);
  const [o] = await tx
    .insert(officers)
    .values({ memberId: m.id, position, committee: input.committee as Committee, termStart: input.termStart, termEnd: input.termEnd, electedAtGa: input.electedAtGa, createdBy: actorId })
    .returning();
  if (!o) throw new Error("officer insert returned no row");
  await audit(tx, { action: "governance.officer_add", entity: "officer", entityId: o.id, after: { memberNo: m.memberNo, position, committee: input.committee, termStart: input.termStart, termEnd: input.termEnd }, userId: actorId });
  return { id: o.id };
}

/** Ends an officer's term (e.g. resigned, replaced). */
export async function endOfficerTerm(tx: Tx, input: { officerId: string; termEnd: BusinessDate }, actorId: string) {
  assertDate(input.termEnd, "end of the term");
  const [o] = await tx.select().from(officers).where(eq(officers.id, input.officerId)).for("update");
  if (!o) throw new GovernanceError("Officer not found");
  if (input.termEnd < o.termStart) throw new GovernanceError("The term ends on or after it starts");
  await tx.update(officers).set({ termEnd: input.termEnd }).where(eq(officers.id, o.id));
  await audit(tx, { action: "governance.officer_end", entity: "officer", entityId: o.id, before: { termEnd: o.termEnd }, after: { termEnd: input.termEnd }, userId: actorId });
}

/** Officers serving on a date (all if no date), by board/committee and position. */
export async function listOfficers(asOf: BusinessDate | null = null, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ officer: officers, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName, middleName: members.middleName, sex: members.sex })
    .from(officers)
    .innerJoin(members, eq(members.id, officers.memberId))
    .where(asOf ? and(lte(officers.termStart, asOf), or(isNull(officers.termEnd), gte(officers.termEnd, asOf))) : undefined)
    .orderBy(asc(officers.committee), asc(officers.position), asc(members.lastName));
  return rows.map((r) => ({ ...r.officer, memberNo: r.memberNo, name: name(r), sex: r.sex, committeeName: COMMITTEE_NAMES[r.officer.committee] }));
}

export type TrainingInput = { title: string; provider: string; heldOn: BusinessDate; hours: string; memberNos: string[] };

/** Records a training and who attended it. */
export async function addTraining(tx: Tx, input: TrainingInput, actorId: string) {
  const title = input.title.trim();
  const provider = input.provider.trim();
  if (!title || !provider) throw new GovernanceError("Enter the title and the provider");
  if (!input.heldOn) throw new GovernanceError("Enter the training date");
  assertDate(input.heldOn, "training date");
  if (input.heldOn > businessToday()) throw new GovernanceError("The training date can't be in the future");
  let hours: Decimal;
  try {
    hours = new Decimal(input.hours.trim());
  } catch {
    throw new GovernanceError("Enter the hours, e.g. 8");
  }
  if (!hours.isFinite() || hours.lte(0) || hours.gt(999) || hours.decimalPlaces() > 2) throw new GovernanceError("Enter the hours, more than 0 (up to 2 decimals)");
  const attendees = await membersByNo(tx, input.memberNos);
  if (attendees.length === 0) throw new GovernanceError("Enter at least one attendee's member no.");
  const [t] = await tx.insert(trainings).values({ title, provider, heldOn: input.heldOn, hours: hours.toFixed(2), createdBy: actorId }).returning();
  if (!t) throw new Error("training insert returned no row");
  await tx.insert(trainingAttendees).values(attendees.map((m) => ({ trainingId: t.id, memberId: m.id, createdBy: actorId })));
  await audit(tx, { action: "governance.training_add", entity: "training", entityId: t.id, after: { title, provider, heldOn: input.heldOn, hours: hours.toFixed(2), attendees: attendees.map((m) => m.memberNo) }, userId: actorId });
  return { id: t.id };
}

/** Trainings held between two dates (latest first), with their attendees. */
export async function listTrainings(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const list = await db.select().from(trainings).where(and(gte(trainings.heldOn, from), lte(trainings.heldOn, to))).orderBy(desc(trainings.heldOn), asc(trainings.title));
  const people = list.length
    ? await db
        .select({ trainingId: trainingAttendees.trainingId, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName, middleName: members.middleName })
        .from(trainingAttendees)
        .innerJoin(members, eq(members.id, trainingAttendees.memberId))
        .where(inArray(trainingAttendees.trainingId, list.map((t) => t.id)))
        .orderBy(asc(members.memberNo))
    : [];
  return list.map((t) => ({ ...t, attendees: people.filter((p) => p.trainingId === t.id).map((p) => ({ memberNo: p.memberNo, name: name(p) })) }));
}

/** Officers who attended at least one training in the period (for the CDA list of officers and trainings). */
export async function officerTrainingHours(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ memberId: trainingAttendees.memberId, hours: sql<string>`sum(${trainings.hours})::text`, count: sql<number>`count(*)::int` })
    .from(trainingAttendees)
    .innerJoin(trainings, eq(trainings.id, trainingAttendees.trainingId))
    .where(and(gte(trainings.heldOn, from), lte(trainings.heldOn, to)))
    .groupBy(trainingAttendees.memberId);
  return new Map(rows.map((r) => [r.memberId, { hours: r.hours, trainings: r.count }]));
}
