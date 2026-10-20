import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { and, eq, isNotNull } from "drizzle-orm";
import { closeDb, getDb, withTx } from "../src/db/client";
import { addDays, businessToday, formatDate } from "../src/lib/dates";
import { format } from "../src/lib/money";
import { users } from "../src/modules/auth/schema";
import { members } from "../src/modules/members/schema";
import { importBatches } from "../src/modules/migration/schema";
import { batchErrors, postMigration, reconciliation, stageBatch, uploadBatch } from "../src/modules/migration/service";
import { MIGRATION_ENTITIES, TEMPLATES, templateFileName, templateWorkbook, type MigrationEntity } from "../src/modules/migration/templates";
import { waterRoutes, waterZones } from "../src/modules/water/schema";
import { addRoute, addZone } from "../src/modules/water/service";
import { DEMO_PUROKS, demoMigration, type Cells } from "./fixtures/demo-migration";
import { ensureDemoUsers } from "./fixtures/demo-users";

// DEMO ONLY (PHASE-17): Pipindan's puroks as water zones, sample migration files in demo/migration/,
// and (unless --files-only) the whole migration run through the import: upload, check, stage,
// reconcile and post the opening balances as of the cut-off. Local databases only, fresh ones only.
//   npm run db:seed:demo                       cut-off = the last month end
//   npm run db:seed:demo -- --cutoff=2026-09-30
//   npm run db:seed:demo -- --files-only       just the zones and the Excel files (to upload by hand)

if (existsSync(".env")) process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (process.env.APP_ENV === "production" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
  console.error(`refusing to load demo data into ${url.hostname} (APP_ENV=${process.env.APP_ENV})`);
  process.exit(1);
}

const args = process.argv.slice(2);
const filesOnly = args.includes("--files-only");
const cutoff = args.find((a) => a.startsWith("--cutoff="))?.slice("--cutoff=".length) ?? addDays(`${businessToday().slice(0, 7)}-01`, -1);
const adminName = (process.env.SEED_ADMIN_USERNAME || "admin").toLowerCase();
const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.username, adminName));
if (!admin) {
  console.error(`Run npm run db:seed first (admin "${adminName}" not found)`);
  process.exit(1);
}

// 1. The puroks as water zones, one reading route each.
await withTx(async (tx) => {
  for (const p of DEMO_PUROKS) {
    let [zone] = await tx.select().from(waterZones).where(eq(waterZones.code, p.code));
    if (!zone) {
      await addZone(tx, { code: p.code, name: p.name }, admin.id);
      [zone] = await tx.select().from(waterZones).where(eq(waterZones.code, p.code));
    }
    const [route] = await tx.select().from(waterRoutes).where(eq(waterRoutes.code, `${p.code}-R1`));
    if (!route && zone) await addRoute(tx, { zoneId: zone.id, code: `${p.code}-R1`, name: `${p.name} route 1` }, admin.id);
  }
});
console.log(`water zones: ${DEMO_PUROKS.map((p) => p.name).join(", ")}`);

// 2. The sample files.
const data = demoMigration(cutoff);
const dir = path.join("demo", "migration");
mkdirSync(dir, { recursive: true });
async function filled(entity: MigrationEntity, rows: Cells[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await templateWorkbook(entity));
  const ws = wb.getWorksheet(TEMPLATES[entity].sheet);
  if (!ws) throw new Error(`template ${entity} has no data sheet`);
  const headers = TEMPLATES[entity].columns.map((c) => c.header);
  rows.forEach((r, i) => {
    for (const [header, value] of Object.entries(r)) {
      if (value !== null && value !== "") ws.getCell(i + 2, headers.indexOf(header) + 1).value = value;
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const files = new Map<MigrationEntity, { name: string; content: Buffer }>();
for (const [k, entity] of MIGRATION_ENTITIES.entries()) {
  const name = `${String(k + 1).padStart(2, "0")}-${templateFileName(entity)}`;
  const content = await filled(entity, data[entity]);
  writeFileSync(path.join(dir, name), content);
  files.set(entity, { name, content });
}
console.log(`sample files (cut-off ${formatDate(cutoff)}) written to ${dir}${path.sep}`);
if (filesOnly) {
  console.log("--files-only: upload them on Admin › Data migration, in their numbered order");
  await closeDb();
  process.exit(0);
}

// 3. The import, as the bookkeeper would do it on Admin › Data migration (here as the administrator).
const [someMember] = await getDb().select({ id: members.id }).from(members).where(isNotNull(members.memberNo)).limit(1);
const [someBatch] = await getDb().select({ id: importBatches.id }).from(importBatches).where(and(eq(importBatches.status, "POSTED"))).limit(1);
if (someMember || someBatch) {
  console.error("This database already has members or a posted migration. The demo migration needs a fresh one:");
  console.error("  npm run db:reset && npm run db:migrate && npm run db:seed && npm run db:seed:demo");
  await closeDb();
  process.exit(1);
}
for (const entity of MIGRATION_ENTITIES) {
  const file = files.get(entity);
  if (!file) continue;
  const b = await withTx((tx) => uploadBatch(tx, { entity, fileName: file.name, content: file.content, cutoffDate: cutoff }, admin.id));
  if (b.errorCount > 0) {
    console.error(`${TEMPLATES[entity].title}: ${b.errorCount} problem(s)`);
    for (const e of (await batchErrors(b.id)).slice(0, 20)) console.error(`  row ${e.row} · ${e.column}: ${e.message}`);
    process.exitCode = 1;
    break;
  }
  const staged = await withTx((tx) => stageBatch(tx, b.id, admin.id));
  console.log(`  ${TEMPLATES[entity].title}: ${staged.rowCount} rows staged`);
}
if (!process.exitCode) {
  const rec = await reconciliation(cutoff);
  if (!rec.canPost) {
    console.error(`posting blocked:\n  ${rec.blockers.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    const posted = await withTx((tx) => postMigration(tx, { cutoffDate: cutoff }, admin.id));
    console.log(`opening balances posted: ${posted.jeNo} (${posted.counts.lines} lines; trial balance ${format(rec.tbDebit)}); ${posted.counts.monthsClosed} month(s) closed`);
    console.log(`  ${Object.entries(posted.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
}

// 4. The demo accounts.
await ensureDemoUsers(admin.id);
await closeDb();
