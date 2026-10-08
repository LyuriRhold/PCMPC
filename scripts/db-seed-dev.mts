import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, withTx } from "../src/db/client";
import { addDays, businessToday } from "../src/lib/dates";
import { users } from "../src/modules/auth/schema";
import { and, isNotNull } from "drizzle-orm";
import { journalEntries } from "../src/modules/ledger/schema";
import { accountIdFor, postJournal, trialBalance } from "../src/modules/ledger/service";
import { members } from "../src/modules/members/schema";
import { approveMember, createApplicant, MemberRuleError, setBeneficiaries } from "../src/modules/members/service";
import { memberInputSchema } from "../src/modules/members/validation";
import { DEV_ENTRIES } from "./fixtures/dev-ledger";
import { DEV_MEMBERS } from "./fixtures/dev-members";

// DEV ONLY: loads sample members (T2.6). Never runs against production or a non-local database.
if (existsSync(".env")) process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (process.env.APP_ENV === "production" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
  console.error(`refusing to load dev sample data into ${url.hostname} (APP_ENV=${process.env.APP_ENV})`);
  process.exit(1);
}

const adminName = (process.env.SEED_ADMIN_USERNAME ?? "admin").toLowerCase();
let created = 0;
let skipped = 0;
await withTx(async (tx) => {
  const [admin] = await tx.select({ id: users.id }).from(users).where(eq(users.username, adminName));
  if (!admin) throw new Error(`Run npm run db:seed first (admin "${adminName}" not found)`);
  const pmesDate = addDays(businessToday(), -7);
  for (const [i, sample] of DEV_MEMBERS.entries()) {
    const data = memberInputSchema.parse(sample.input);
    try {
      await tx.execute("SAVEPOINT dev_member");
      const m = await createApplicant(tx, data, admin.id);
      if (sample.beneficiaries) await setBeneficiaries(tx, m.id, sample.beneficiaries, admin.id);
      if (sample.approve) {
        await approveMember(tx, { memberId: m.id, pmesDate, bodResolutionNo: `DEV-${i + 1}`, privacyConsent: true }, admin.id);
      }
      await tx.execute("RELEASE SAVEPOINT dev_member");
      created += 1;
    } catch (e) {
      if (!(e instanceof MemberRuleError) || !e.message.startsWith("Possible duplicate")) throw e;
      await tx.execute("ROLLBACK TO SAVEPOINT dev_member");
      skipped += 1;
    }
  }
});
console.log(`dev members: ${created} created, ${skipped} already present`);

// Sample postings (once). Members are the approved samples, in member-number order.
const posted = await withTx(async (tx) => {
  const [already] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.sourceModule, "dev_seed")).limit(1);
  if (already) return 0;
  const sample = await tx
    .select({ id: members.id, memberNo: members.memberNo })
    .from(members)
    .where(and(isNotNull(members.memberNo), eq(members.remarks, "DEV SAMPLE (scripts/fixtures/dev-members.ts)")))
    .orderBy(members.memberNo);
  const today = businessToday();
  for (const e of DEV_ENTRIES) {
    const lines = [];
    for (const l of e.lines) {
      const memberId = l.member === undefined ? null : sample[l.member]?.id;
      if (l.member !== undefined && !memberId) throw new Error(`sample member #${l.member} not found`);
      lines.push({ accountId: await accountIdFor(l.key, tx), debit: BigInt(l.debit ?? 0) * 100n, credit: BigInt(l.credit ?? 0) * 100n, memberId });
    }
    await postJournal(tx, { date: today, book: e.book, particulars: e.particulars, source: { module: "dev_seed" }, lines }, null);
  }
  return DEV_ENTRIES.length;
});
const tb = await trialBalance(businessToday());
console.log(`dev ledger: ${posted} sample entries posted; trial balance ${tb.balanced ? "balances" : "DOES NOT balance"} (${tb.totalDebit} = ${tb.totalCredit} centavos)`);
if (!tb.balanced) process.exitCode = 1;
await closeDb();
