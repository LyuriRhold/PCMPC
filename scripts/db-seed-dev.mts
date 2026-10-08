import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, withTx } from "../src/db/client";
import { addDays, businessToday } from "../src/lib/dates";
import { users } from "../src/modules/auth/schema";
import { approveMember, createApplicant, MemberRuleError, setBeneficiaries } from "../src/modules/members/service";
import { memberInputSchema } from "../src/modules/members/validation";
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
await closeDb();
