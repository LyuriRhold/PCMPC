import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { businessToday, startOfBusinessDay, addDays, type BusinessDate } from "@/lib/dates";
import { members, memberStatusHistory } from "@/modules/members/schema";

/**
 * Membership counts for the dashboard and the CDA report (PHASE-16): members (active and inactive:
 * approved and not terminated or deceased) by type and sex; members who joined and who left in a period.
 */

export type BySex = { male: number; female: number; total: number };
export type MembershipSummary = { regular: BySex; associate: BySex; total: number };

const empty = (): BySex => ({ male: 0, female: 0, total: 0 });

/** Today's members by type and sex. */
export async function membershipSummary(db: Db | Tx = getDb()): Promise<MembershipSummary> {
  const rows = await db
    .select({ type: members.type, sex: members.sex, n: sql<number>`count(*)::int` })
    .from(members)
    .where(inArray(members.status, ["ACTIVE", "INACTIVE"]))
    .groupBy(members.type, members.sex);
  const out: MembershipSummary = { regular: empty(), associate: empty(), total: 0 };
  for (const r of rows) {
    const bucket = r.type === "ASSOCIATE" ? out.associate : out.regular;
    if (r.sex === "FEMALE") bucket.female += r.n;
    else bucket.male += r.n;
    bucket.total += r.n;
    out.total += r.n;
  }
  return out;
}

/** Members who joined (membership date) and who left (terminated or deceased) between two dates. */
export async function membershipMovement(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const joined = await db
    .select({ type: members.type, sex: members.sex, n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(gte(members.membershipDate, from), lte(members.membershipDate, to)))
    .groupBy(members.type, members.sex);
  const left = await db
    .select({ type: members.type, sex: members.sex, to: memberStatusHistory.toStatus, n: sql<number>`count(*)::int` })
    .from(memberStatusHistory)
    .innerJoin(members, eq(members.id, memberStatusHistory.memberId))
    .where(and(inArray(memberStatusHistory.toStatus, ["TERMINATED", "DECEASED"]), gte(memberStatusHistory.at, startOfBusinessDay(from)), sql`${memberStatusHistory.at} < ${startOfBusinessDay(addDays(to, 1))}`))
    .groupBy(members.type, members.sex, memberStatusHistory.toStatus);
  const sum = (rows: Array<{ n: number }>) => rows.reduce((s, r) => s + r.n, 0);
  return {
    joined: { regular: sum(joined.filter((r) => r.type === "REGULAR")), associate: sum(joined.filter((r) => r.type === "ASSOCIATE")), male: sum(joined.filter((r) => r.sex === "MALE")), female: sum(joined.filter((r) => r.sex === "FEMALE")), total: sum(joined) },
    terminated: sum(left.filter((r) => r.to === "TERMINATED")),
    deceased: sum(left.filter((r) => r.to === "DECEASED")),
  };
}

/** Members who joined this month (dashboard). */
export async function newMembersThisMonth(db: Db | Tx = getDb()): Promise<number> {
  const today = businessToday();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(and(gte(members.membershipDate, `${today.slice(0, 7)}-01`), lte(members.membershipDate, today)));
  return r?.n ?? 0;
}
