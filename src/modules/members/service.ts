import { and, asc, desc, eq, like, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { businessToday, now } from "@/lib/dates";
import { nameKey, normalizeName } from "@/lib/names";
import { next as nextNumber } from "@/lib/numbering";
import { users } from "@/modules/auth/schema";
import { maskSensitive } from "./masking";
import {
  memberBeneficiaries,
  members,
  memberStatusHistory,
  type Member,
  type MemberStatus,
  type MemberType,
} from "./schema";
import { canTerminate } from "./termination";
import { pctToHundredths, type MemberData } from "./validation";

/** A member rule was broken; the message is safe to show to staff. */
export class MemberRuleError extends Error {
  override name = "MemberRuleError";
}

const TERMINAL: readonly MemberStatus[] = ["TERMINATED", "DECEASED"];

/** Allowed status changes outside approval (DOMAIN §4: APPLICANT → ACTIVE → (INACTIVE ↔ ACTIVE) → TERMINATED / DECEASED). */
const TRANSITIONS: Record<MemberStatus, readonly MemberStatus[]> = {
  APPLICANT: [],
  ACTIVE: ["INACTIVE", "TERMINATED", "DECEASED"],
  INACTIVE: ["ACTIVE", "TERMINATED", "DECEASED"],
  TERMINATED: [],
  DECEASED: [],
};

function searchTextOf(m: { memberNo: string | null; lastName: string; firstName: string; middleName: string | null; suffix: string | null }) {
  return normalizeName([m.memberNo, m.lastName, m.firstName, m.middleName, m.suffix].filter(Boolean).join(" "));
}

/** The audit-safe view of a member (identifiers only, no sensitive numbers). */
function auditView(m: Member) {
  return {
    memberNo: m.memberNo,
    status: m.status,
    type: m.type,
    lastName: m.lastName,
    firstName: m.firstName,
    middleName: m.middleName,
    pmesDate: m.pmesDate,
    bodResolutionNo: m.bodResolutionNo,
    membershipDate: m.membershipDate,
  };
}

async function loadForUpdate(tx: Tx, memberId: string): Promise<Member> {
  const [m] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (!m) throw new MemberRuleError("Member not found");
  return m;
}

/**
 * Blocks a save when a non-terminated member has the same normalized last + first name and
 * birthdate. A transaction-scoped advisory lock on that key stops two saves racing past the check.
 */
async function assertNoDuplicate(tx: Tx, key: string, birthdate: string, exceptId: string | null): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`member:${key}:${birthdate}`}))`);
  const conds: SQL[] = [eq(members.nameKey, key), eq(members.birthdate, birthdate), notInArray(members.status, [...TERMINAL])];
  if (exceptId) conds.push(ne(members.id, exceptId));
  const [dup] = await tx.select().from(members).where(and(...conds)).limit(1);
  if (!dup) return;
  throw new MemberRuleError(
    dup.memberNo
      ? `Possible duplicate of ${dup.memberNo} (${dup.lastName}, ${dup.firstName}, born ${dup.birthdate})`
      : `Possible duplicate of applicant ${dup.lastName}, ${dup.firstName} (born ${dup.birthdate}, no member no. yet)`,
  );
}

function assertBirthdate(birthdate: string): void {
  if (birthdate > businessToday()) throw new MemberRuleError("Birthdate can't be in the future");
}

function columnsFrom(data: MemberData) {
  return {
    type: data.type,
    lastName: data.lastName,
    firstName: data.firstName,
    middleName: data.middleName,
    suffix: data.suffix,
    birthdate: data.birthdate,
    sex: data.sex,
    civilStatus: data.civilStatus,
    addrStreet: data.addrStreet,
    addrPurok: data.addrPurok,
    addrBarangay: data.addrBarangay,
    addrMunicipality: data.addrMunicipality,
    addrProvince: data.addrProvince,
    mobile: data.mobile,
    email: data.email,
    occupation: data.occupation,
    employer: data.employer,
    tin: data.tin,
    validIdType: data.validIdType,
    validIdNo: data.validIdNo,
    pmesDate: data.pmesDate,
    bodResolutionNo: data.bodResolutionNo,
    remarks: data.remarks,
  };
}

/** Encodes a membership application. New records are APPLICANT with no member no. */
export async function createApplicant(tx: Tx, data: MemberData, actorId: string | null): Promise<Member> {
  assertBirthdate(data.birthdate);
  const key = nameKey(data.lastName, data.firstName);
  await assertNoDuplicate(tx, key, data.birthdate, null);
  const at = now();
  const [m] = await tx
    .insert(members)
    .values({
      ...columnsFrom(data),
      status: "APPLICANT",
      memberNo: null,
      nameKey: key,
      searchText: searchTextOf({ ...data, memberNo: null }),
      privacyConsentAt: data.privacyConsent ? at : null,
      createdBy: actorId,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (!m) throw new Error("member insert returned no row");
  await audit(tx, { action: "member.create", entity: "member", entityId: m.id, before: null, after: auditView(m), userId: actorId });
  return m;
}

/** Edits a member's details. Terminated or deceased members are read-only. */
export async function updateMember(tx: Tx, memberId: string, data: MemberData, actorId: string): Promise<Member> {
  const before = await loadForUpdate(tx, memberId);
  if (TERMINAL.includes(before.status)) throw new MemberRuleError(`A ${before.status} member can't be edited`);
  assertBirthdate(data.birthdate);
  const key = nameKey(data.lastName, data.firstName);
  await assertNoDuplicate(tx, key, data.birthdate, memberId);
  const at = now();
  const [after] = await tx
    .update(members)
    .set({
      ...columnsFrom(data),
      // Approved members keep their PMES/BOD record; those fields are set through approval.
      ...(before.status === "APPLICANT" ? {} : { pmesDate: before.pmesDate, bodResolutionNo: before.bodResolutionNo }),
      nameKey: key,
      searchText: searchTextOf({ ...data, memberNo: before.memberNo }),
      privacyConsentAt: before.privacyConsentAt ?? (data.privacyConsent ? at : null),
      updatedAt: at,
    })
    .where(eq(members.id, memberId))
    .returning();
  if (!after) throw new Error("member update returned no row");
  await audit(tx, { action: "member.update", entity: "member", entityId: memberId, before: auditView(before), after: auditView(after), userId: actorId });
  return after;
}

async function writeHistory(
  tx: Tx,
  m: Member,
  to: MemberStatus,
  reason: string,
  ref: string | null,
  actorId: string | null,
): Promise<void> {
  await tx.insert(memberStatusHistory).values({
    memberId: m.id,
    fromStatus: m.status,
    toStatus: to,
    reason,
    ref,
    at: now(),
    by: actorId,
    createdBy: actorId,
  });
}

export type ApproveInput = { memberId: string; pmesDate: string | null; bodResolutionNo: string | null; privacyConsent?: boolean };

/**
 * Board approval: needs a PMES date, a BOD resolution no. and privacy consent. Assigns the next
 * member no. (series MEMBER), sets ACTIVE and membership_date = today's business date.
 */
export async function approveMember(tx: Tx, input: ApproveInput, actorId: string): Promise<Member> {
  const before = await loadForUpdate(tx, input.memberId);
  if (before.status !== "APPLICANT") throw new MemberRuleError(`Only applicants can be approved (this member is ${before.status})`);
  const pmesDate = input.pmesDate ?? before.pmesDate;
  const bodResolutionNo = input.bodResolutionNo?.trim() || before.bodResolutionNo;
  if (!pmesDate) throw new MemberRuleError("PMES date is required");
  if (!bodResolutionNo) throw new MemberRuleError("BOD resolution no. is required");
  if (!before.privacyConsentAt && !input.privacyConsent) throw new MemberRuleError("Privacy consent is required");
  const today = businessToday();
  if (pmesDate > today) throw new MemberRuleError("PMES date can't be in the future");

  const memberNo = await nextNumber("MEMBER", tx, today);
  const at = now();
  const [after] = await tx
    .update(members)
    .set({
      status: "ACTIVE",
      memberNo,
      pmesDate,
      bodResolutionNo,
      privacyConsentAt: before.privacyConsentAt ?? at,
      approvedAt: at,
      approvedBy: actorId,
      membershipDate: today,
      searchText: searchTextOf({ ...before, memberNo }),
      updatedAt: at,
    })
    .where(eq(members.id, before.id))
    .returning();
  if (!after) throw new Error("member update returned no row");
  await writeHistory(tx, before, "ACTIVE", "Membership approved by the Board", `BOD Res. ${bodResolutionNo}`, actorId);
  await audit(tx, { action: "member.approve", entity: "member", entityId: before.id, before: auditView(before), after: auditView(after), userId: actorId });
  return after;
}

export type ChangeStatusInput = { memberId: string; to: MemberStatus; reason: string; ref: string | null };

/** Changes a member's status along DOMAIN §4. TERMINATED and DECEASED are terminal. */
export async function changeStatus(tx: Tx, input: ChangeStatusInput, actorId: string): Promise<Member> {
  const before = await loadForUpdate(tx, input.memberId);
  if (TERMINAL.includes(before.status)) {
    throw new MemberRuleError(`This member is ${before.status}, a terminal status; it can't be changed`);
  }
  if (before.status === "APPLICANT") throw new MemberRuleError("An applicant becomes ACTIVE only through approval");
  if (before.status === input.to) throw new MemberRuleError(`This member is already ${input.to}`);
  if (!TRANSITIONS[before.status].includes(input.to)) {
    throw new MemberRuleError(`Can't change status from ${before.status} to ${input.to}`);
  }
  if (input.to === "TERMINATED") {
    const check = await canTerminate(before.id, tx);
    if (!check.ok) throw new MemberRuleError(`Can't terminate: ${check.reasons.join("; ")}`);
  }
  const [after] = await tx
    .update(members)
    .set({ status: input.to, updatedAt: now() })
    .where(eq(members.id, before.id))
    .returning();
  if (!after) throw new Error("member update returned no row");
  await writeHistory(tx, before, input.to, input.reason, input.ref, actorId);
  await audit(tx, {
    action: "member.status_change",
    entity: "member",
    entityId: before.id,
    before: auditView(before),
    after: { ...auditView(after), reason: input.reason, ref: input.ref },
    userId: actorId,
  });
  return after;
}

export type BeneficiaryData = { name: string; relationship: string; birthdate: string | null; sharePct: string };

/**
 * Replaces a member's beneficiaries. When there are any, their shares must total exactly 100%
 * (compared in hundredths of a percent, so no floating point).
 */
export async function setBeneficiaries(tx: Tx, memberId: string, list: BeneficiaryData[], actorId: string): Promise<void> {
  const m = await loadForUpdate(tx, memberId);
  if (TERMINAL.includes(m.status)) throw new MemberRuleError(`A ${m.status} member's beneficiaries can't be changed`);
  const today = businessToday();
  for (const b of list) {
    if (pctToHundredths(b.sharePct) <= 0) throw new MemberRuleError(`${b.name}'s share must be more than 0%`);
    if (b.birthdate && b.birthdate > today) throw new MemberRuleError(`${b.name}'s birthdate can't be in the future`);
  }
  if (list.length > 0) {
    const total = list.reduce((s, b) => s + pctToHundredths(b.sharePct), 0);
    if (total !== 10000) {
      const pct = `${Math.floor(total / 100)}${total % 100 ? `.${String(total % 100).padStart(2, "0")}` : ""}`;
      throw new MemberRuleError(`Beneficiary shares must total 100% (now ${pct}%)`);
    }
  }
  const before = await tx.select().from(memberBeneficiaries).where(eq(memberBeneficiaries.memberId, memberId));
  await tx.delete(memberBeneficiaries).where(eq(memberBeneficiaries.memberId, memberId));
  if (list.length > 0) {
    await tx.insert(memberBeneficiaries).values(
      list.map((b) => ({ memberId, name: b.name, relationship: b.relationship, birthdate: b.birthdate, sharePct: b.sharePct, createdBy: actorId })),
    );
  }
  const view = (rows: Array<{ name: string; relationship: string; sharePct: string }>) =>
    rows.map((b) => ({ name: b.name, relationship: b.relationship, sharePct: b.sharePct }));
  await audit(tx, {
    action: "member.beneficiaries",
    entity: "member",
    entityId: memberId,
    before: { beneficiaries: view(before) },
    after: { beneficiaries: view(list) },
    userId: actorId,
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────

export type MemberFilters = { q?: string; status?: MemberStatus; type?: MemberType; page?: number; pageSize?: number };

/** Case-, accent- and extra-space-insensitive search on names and member no. */
export async function searchMembers(filters: MemberFilters, db: Db | Tx = getDb()) {
  const conds: SQL[] = [];
  for (const token of normalizeName(filters.q).split(" ").filter(Boolean)) {
    conds.push(like(members.searchText, `%${token}%`));
  }
  if (filters.status) conds.push(eq(members.status, filters.status));
  if (filters.type) conds.push(eq(members.type, filters.type));
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: members.id,
        memberNo: members.memberNo,
        lastName: members.lastName,
        firstName: members.firstName,
        middleName: members.middleName,
        suffix: members.suffix,
        type: members.type,
        status: members.status,
        addrBarangay: members.addrBarangay,
        membershipDate: members.membershipDate,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(where)
      .orderBy(sql`${members.memberNo} IS NULL`, asc(members.memberNo), asc(members.lastName), asc(members.firstName))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(members).where(where),
  ]);
  return { rows, total: count?.n ?? 0, page, pageSize };
}

export type MemberView = Omit<Member, "nameKey" | "searchText">;

/** Drops the internal search/duplicate keys from a member row. */
function toView(m: Member): MemberView {
  const view: Partial<Member> = { ...m };
  delete view.nameKey;
  delete view.searchText;
  return view as MemberView;
}

/** A member profile with beneficiaries and status history; sensitive fields masked unless allowed. */
export async function getMemberProfile(memberId: string, canSeeSensitive: boolean, db: Db | Tx = getDb()) {
  const [m] = await db.select().from(members).where(eq(members.id, memberId));
  if (!m) return null;
  const [beneficiaries, history] = await Promise.all([
    db
      .select({
        id: memberBeneficiaries.id,
        name: memberBeneficiaries.name,
        relationship: memberBeneficiaries.relationship,
        birthdate: memberBeneficiaries.birthdate,
        sharePct: memberBeneficiaries.sharePct,
      })
      .from(memberBeneficiaries)
      .where(eq(memberBeneficiaries.memberId, memberId))
      .orderBy(desc(memberBeneficiaries.sharePct), asc(memberBeneficiaries.name)),
    db
      .select({
        id: memberStatusHistory.id,
        fromStatus: memberStatusHistory.fromStatus,
        toStatus: memberStatusHistory.toStatus,
        reason: memberStatusHistory.reason,
        ref: memberStatusHistory.ref,
        at: memberStatusHistory.at,
        byUsername: users.username,
      })
      .from(memberStatusHistory)
      .leftJoin(users, eq(users.id, memberStatusHistory.by))
      .where(eq(memberStatusHistory.memberId, memberId))
      .orderBy(desc(memberStatusHistory.at)),
  ]);
  const member: MemberView = canSeeSensitive ? toView(m) : maskSensitive(toView(m));
  return {
    member,
    beneficiaries: beneficiaries.map((b) => (canSeeSensitive ? b : { ...b, birthdate: b.birthdate ? "••••-••-••" : null })),
    history,
  };
}
