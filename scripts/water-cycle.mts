import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, withTx } from "../src/db/client";
import { runDailyJobs } from "../src/lib/cron";
import { setClock } from "../src/lib/dates";
import { format } from "../src/lib/money";
import "../src/modules/plugins";
import { createUser } from "../src/modules/auth/service";
import { issueReceipt, openSession } from "../src/modules/cashiering/service";
import { journalLines } from "../src/modules/ledger/schema";
import { accountIdFor } from "../src/modules/ledger/service";
import { postRun } from "../src/modules/water/billing";
import { accountOutstanding, disconnect, disconnectionList, issueNotice, reconnect } from "../src/modules/water/collections";
import { approveReading, enterReading, openPeriod } from "../src/modules/water/readings";
import { customerSoa } from "../src/modules/water/reports";
import { waterAccounts, waterBills } from "../src/modules/water/schema";
import { addMeter, addRoute, addZone, approveApplication, createApplication, createCustomer, installMeter } from "../src/modules/water/service";

// DEV ONLY (PHASE-07 exit check): one full water cycle on the local seed data —
// connect → read → bill → penalty → disconnect → pay → reconnect — with the GL checked at the end.
if (existsSync(".env")) process.loadEnvFile(".env");
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (process.env.APP_ENV === "production" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
  console.error(`refusing to run the water cycle against ${url.hostname} (APP_ENV=${process.env.APP_ENV})`);
  process.exit(1);
}

const tag = randomBytes(3).toString("hex").toUpperCase();
const day = (d: string) => setClock(() => new Date(`${d}T01:00:00Z`));
const step = (s: string) => console.log(`• ${s}`);

async function user(role: string, name: string) {
  const username = `sim_${name}_${tag}`.toLowerCase();
  const u = await withTx((tx) => createUser(tx, { username, fullName: `Simulation ${role}`, roleCode: role, password: `Sim-${randomBytes(9).toString("hex")}`, email: null }, null));
  return u.id;
}

async function teller(date: string) {
  day(date);
  const id = await user("TELLER", `teller${date.replaceAll("-", "")}`);
  await withTx((tx) => openSession(tx, id, 0n));
  return id;
}

async function pay(tellerId: string, customerId: string, items: Array<{ type: string; refId: string; amount: bigint }>) {
  const r = await withTx((tx) =>
    issueReceipt(tx, { payor: { type: "WATER_CUSTOMER", id: customerId, name: "" }, mode: "CASH", checkNo: null, birReceiptNo: `SIM-${tag}-${Math.random().toString(36).slice(2, 7)}`, items: items.map((i) => ({ ...i, description: null })) }, tellerId),
  );
  return r.receiptNo;
}

try {
  day("2026-06-01");
  const clerk = await user("BILLING_CLERK", "clerk");
  const manager = await user("MANAGER", "mgr");

  // Connect.
  const zone = await withTx((tx) => addZone(tx, { code: `SIM${tag}`, name: `Simulation ${tag}` }, clerk));
  const route = await withTx((tx) => addRoute(tx, { zoneId: zone.id, code: `SIM${tag}-R1`, name: "Simulation route" }, clerk));
  const customer = await withTx((tx) =>
    createCustomer(tx, { type: "NON_MEMBER", memberId: null, lastName: `Simulation ${tag}`, firstName: "Ana", middleName: null, businessName: null, address: "Purok 1, Pipindan", mobile: null, email: null, validIdType: null, validIdNo: null, privacyConsent: true, remarks: null }, clerk),
  );
  const app = await withTx((tx) => createApplication(tx, { customerId: customer.id, classification: "RESIDENTIAL", serviceAddress: "Purok 1, Pipindan", routeId: route.id }, clerk));
  const { account } = await withTx((tx) => approveApplication(tx, app.id, manager));
  const t1 = await teller("2026-06-01");
  const fees = await pay(t1, customer.id, [
    { type: "WATER_CONNECTION_FEE", refId: app.id, amount: 350000n },
    { type: "METER_DEPOSIT", refId: app.id, amount: 100000n },
  ]);
  await withTx((tx) => addMeter(tx, { serialNo: `SIM-${tag}`, brand: null, size: null, digits: 4 }, clerk));
  await withTx((tx) => installMeter(tx, { applicationId: app.id, meterSerial: `SIM-${tag}`, initialReading: 0 }, clerk));
  step(`connected ${account.accountNo} for ${customer.customerNo}; fees paid on ${fees}`);

  // Read and bill June and July (bills due the 15th of the next month).
  for (const [period, present, billDate] of [
    ["2026-06", 18, "2026-06-30"],
    ["2026-07", 36, "2026-07-31"],
  ] as const) {
    day(billDate);
    const p = await withTx((tx) => openPeriod(tx, { period, zoneId: zone.id, readingFrom: `${period}-01`, readingTo: `${period}-25`, billDate }, clerk));
    const r = await withTx((tx) => enterReading(tx, { periodId: p.id, accountId: account.id, presentReading: present, rollover: false, remarks: null }, clerk, "OFFICE"));
    if (r.status !== "APPROVED") await withTx((tx) => approveReading(tx, r.id, clerk));
    const run = await withTx((tx) => postRun(tx, p.id, clerk));
    step(`${period}: read ${present}, billed ${run.bills} bill(s) ${format(BigInt(run.total))}`);
  }

  // The June bill goes unpaid past its due date: the daily job assesses the penalty.
  day("2026-07-16");
  const jobs = await runDailyJobs("2026-07-16");
  step(`daily jobs 2026-07-16: ${jobs.map((j) => `${j.job} ${j.status} ${JSON.stringify(j.result ?? {})}`).join("; ")}`);

  // Two unpaid bills → disconnection list → notice → disconnection after the notice period.
  day("2026-08-01");
  const listed = (await disconnectionList()).some((l) => l.accountId === account.id);
  const notice = await withTx((tx) => issueNotice(tx, account.id, clerk));
  step(`on the disconnection list: ${listed}; notice ${notice.noticeNo} (pay by ${notice.scheduledDate}, ${format(notice.noticeAmount)})`);
  day(notice.scheduledDate);
  await withTx((tx) => disconnect(tx, { disconnectionId: notice.id, reading: 40 }, clerk));
  step(`disconnected on ${notice.scheduledDate} at reading 40`);

  // The customer pays everything plus the reconnection fee; the account is reconnected.
  const t2 = await teller(notice.scheduledDate);
  const owed = await accountOutstanding(account.id);
  const receipt = await pay(t2, customer.id, [
    { type: "WATER_BILL", refId: account.id, amount: owed },
    { type: "WATER_OTHER_FEE", refId: "RECONNECTION", amount: 30000n },
  ]);
  await withTx((tx) => reconnect(tx, { disconnectionId: notice.id, reading: 40 }, clerk));
  step(`paid ${format(owed)} + reconnection fee ₱300.00 on ${receipt}; reconnected`);

  // Check: bills paid, account ACTIVE, SOA = GL AR–Water = 0.
  const [a] = await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, account.id));
  const bills = await getDb().select({ billNo: waterBills.billNo, status: waterBills.status }).from(waterBills).where(eq(waterBills.accountId, account.id));
  const soa = await customerSoa(customer.id);
  const ar = await accountIdFor("ar_water");
  const gl = (await getDb().select().from(journalLines).where(and(eq(journalLines.accountId, ar), eq(journalLines.customerId, customer.id)))).reduce((s, l) => s + l.debit - l.credit, 0n);
  step(`account ${a?.status}; bills ${bills.map((b) => `${b.billNo} ${b.status}`).join(", ")}`);
  step(`SOA ending balance ${format(soa.endingBalance)}; GL AR–Water for the customer ${format(gl)}`);
  const ok = a?.status === "ACTIVE" && bills.every((b) => b.status === "PAID") && soa.endingBalance === 0n && gl === 0n;
  console.log(ok ? "water cycle: OK" : "water cycle: MISMATCH");
  process.exitCode = ok ? 0 : 1;
} finally {
  setClock(null);
  await closeDb();
}
