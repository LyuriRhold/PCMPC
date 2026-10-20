import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { formatDate, monthEnd, now, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { advancePast } from "@/lib/numbering";
import { closeThroughCutoff } from "@/modules/accounting/close";
import { ensureFiscalYear, fiscalYearOf, periodOf } from "@/modules/ledger/periods";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { loanProducts } from "@/modules/loans/schema";
import { migrateLoan } from "@/modules/loans/servicing";
import { members, type MemberType } from "@/modules/members/schema";
import { createMigratedMember } from "@/modules/members/service";
import { depositAccounts, depositProducts } from "@/modules/savings/schema";
import { markInterestMigratedThrough, migrateTimeDeposit, openMigratedAccount } from "@/modules/savings/service";
import { migrateShareCapital, recordMigratedMembershipFee } from "@/modules/share/service";
import { setChargeLimit } from "@/modules/store/pos";
import { createSupplier, migrateStockItem } from "@/modules/store/service";
import { waterAccounts, waterCustomers, waterRoutes, waterZones, type Classification, type WaterAccount, type WaterCustomer } from "@/modules/water/schema";
import { createMigratedAccount, createMigratedBill, createMigratedCustomer } from "@/modules/water/service";
import { MigrationError } from "./errors";
import { reconciliation, stagedData } from "./reconcile";
import { importBatches } from "./schema";

/**
 * Posting the opening balances (PHASE-17 T17.5), all in one transaction:
 * 1. the members, water customers and suppliers (the opening entry's lines name them);
 * 2. ONE opening entry (GJ, dated the cut-off, source "migration") from the trial balance: each
 *    control account is split by member, customer or supplier, so every subsidiary ledger agrees;
 * 3. the module records on that entry: share capital, savings and time deposits, loans with their
 *    schedules, water accounts, meters and unpaid bills, store stock, charge limits;
 * 4. the months up to the cut-off are closed and the files marked POSTED.
 */

/** The last quarter end on or before a month end. */
function quarterEndThrough(cutoff: BusinessDate): BusinessDate {
  const year = Number(cutoff.slice(0, 4));
  const month = Number(cutoff.slice(5, 7));
  const q = month - (month % 3);
  return q === 0 ? `${year - 1}-12-31` : monthEnd(`${year}-${String(q).padStart(2, "0")}-01`);
}

type Tag = { memberId?: string; customerId?: string; supplierId?: string };

export async function postMigration(tx: Tx, input: { cutoffDate: BusinessDate }, actorId: string) {
  const cutoff = input.cutoffDate;
  const ref = `MIGRATION-${cutoff}`;
  // One posting at a time: the cut-off's files are locked until this transaction ends.
  await tx.select({ id: importBatches.id }).from(importBatches).where(eq(importBatches.cutoffDate, cutoff)).for("update");
  const rec = await reconciliation(cutoff, tx);
  if (rec.posted) throw new MigrationError("The opening balances for this cut-off are already posted");
  if (!rec.canPost) throw new MigrationError(`Posting is blocked: ${rec.blockers.join("; ")}`);
  const data = await stagedData(cutoff, tx);
  await ensureFiscalYear(tx, await fiscalYearOf(cutoff, tx));
  const period = await periodOf(cutoff, tx);
  if (period?.status !== "OPEN") throw new MigrationError(`The period of the cut-off (${cutoff.slice(0, 7)}) is closed`);

  // Old numbers kept: the number series continue after them (before any new number is issued).
  await advancePast(tx, "MEMBER", data.members.map((m) => m.memberNo));
  await advancePast(tx, "SA", data.savings.flatMap((s) => (s.accountNo ? [s.accountNo] : [])));
  await advancePast(tx, "LN", data.loans.flatMap((l) => (l.loanNo ? [l.loanNo] : [])));
  await advancePast(tx, "WC", data.waterAccounts.flatMap((w) => (w.customerNo ? [w.customerNo] : [])));
  await advancePast(tx, "WA", data.waterAccounts.map((w) => w.accountNo));
  await advancePast(tx, "WB", data.waterBills.flatMap((b) => (b.billNo ? [b.billNo] : [])));

  // 1. Who the lines name.
  const memberIds = new Map<string, string>();
  for (const m of data.members) {
    const created = await createMigratedMember(tx, { ...m, type: m.type as MemberType, status: m.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" }, ref, actorId);
    memberIds.set(m.memberNo, created.id);
  }
  const referenced = [...data.share, ...data.savings, ...data.timeDeposits, ...data.loans, ...data.storeAr].map((r) => r.memberNo).concat(data.waterAccounts.flatMap((w) => (w.memberNo ? [w.memberNo] : [])));
  const inMis = [...new Set(referenced)].filter((no) => !memberIds.has(no));
  if (inMis.length) {
    for (const m of await tx.select({ id: members.id, no: members.memberNo }).from(members).where(inArray(sql`upper(${members.memberNo})`, inMis))) if (m.no) memberIds.set(m.no.toUpperCase(), m.id);
  }
  const memberId = (no: string): string => {
    const id = memberIds.get(no);
    if (!id) throw new MigrationError(`Member ${no} not found`);
    return id;
  };

  const customerByKey = new Map<string, WaterCustomer>();
  const customerOfAccount = new Map<string, WaterCustomer>();
  for (const w of data.waterAccounts) {
    const key = w.customerNo ?? (w.memberNo ? `member:${w.memberNo}` : `row:${w.rowNo}`);
    let c = customerByKey.get(key);
    if (!c) {
      c = await createMigratedCustomer(
        tx,
        {
          customerNo: w.customerNo,
          memberId: w.memberNo ? memberId(w.memberNo) : null,
          lastName: w.lastName,
          firstName: w.firstName,
          middleName: w.middleName,
          businessName: w.businessName,
          address: w.customerAddress,
          mobile: w.mobile,
          date: cutoff,
        },
        actorId,
      );
      customerByKey.set(key, c);
    }
    customerOfAccount.set(w.accountNo, c);
  }
  // Bills on accounts already in the MIS.
  const liveAccountNos = [...new Set(data.waterBills.map((b) => b.accountNo).filter((no) => !customerOfAccount.has(no)))];
  const liveAccounts = new Map<string, { account: WaterAccount; customer: WaterCustomer }>();
  if (liveAccountNos.length) {
    const rows = await tx
      .select({ account: waterAccounts, customer: waterCustomers })
      .from(waterAccounts)
      .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
      .where(inArray(sql`upper(${waterAccounts.accountNo})`, liveAccountNos));
    for (const r of rows) {
      liveAccounts.set(r.account.accountNo.toUpperCase(), r);
      customerOfAccount.set(r.account.accountNo.toUpperCase(), r.customer);
    }
  }
  const customerOf = (accountNo: string): WaterCustomer => {
    const c = customerOfAccount.get(accountNo);
    if (!c) throw new MigrationError(`Water account ${accountNo} not found`);
    return c;
  };

  const supplierIds = new Map<string, string>();
  for (const s of data.suppliers) supplierIds.set(s.name.toUpperCase(), (await createSupplier(tx, { name: s.name, contact: s.contact, tin: s.tin, termsDays: s.termsDays }, actorId)).id);

  // 2. The opening entry.
  const depositByCode = new Map((await tx.select().from(depositProducts)).map((p) => [p.code.toUpperCase(), p]));
  const tdProduct = [...depositByCode.values()].find((p) => p.kind === "TIME" && p.active);
  const loanByCode = new Map((await tx.select().from(loanProducts)).map((p) => [p.code.toUpperCase(), p]));
  const subLines = new Map<string, { key: string; side: "debit" | "credit"; tag: Tag; amount: Money }>();
  const add = (key: string, side: "debit" | "credit", tag: Tag, amount: Money) => {
    if (amount === 0n) return;
    const id = `${key}|${side}|${tag.memberId ?? ""}|${tag.customerId ?? ""}|${tag.supplierId ?? ""}`;
    const line = subLines.get(id) ?? { key, side, tag, amount: 0n };
    line.amount += amount;
    subLines.set(id, line);
  };
  for (const s of data.share) {
    add("subscribed_share_capital_common", "credit", { memberId: memberId(s.memberNo) }, s.subscribed);
    add("subscription_receivable_common", "debit", { memberId: memberId(s.memberNo) }, s.subscribed - s.paidUp);
  }
  for (const s of data.savings) add(depositByCode.get(s.productCode)?.depositGlKey ?? "savings_deposits", "credit", { memberId: memberId(s.memberNo) }, s.balance);
  for (const t of data.timeDeposits) add(tdProduct?.depositGlKey ?? "time_deposits", "credit", { memberId: memberId(t.memberNo) }, t.principal);
  for (const l of data.loans) add(loanByCode.get(l.productCode)?.receivableGlKey ?? `loans_receivable_${l.productCode}`, "debit", { memberId: memberId(l.memberNo) }, l.outstandingPrincipal);
  for (const a of data.storeAr) add("accounts_receivable_members", "debit", { memberId: memberId(a.memberNo) }, a.balance);
  for (const b of data.waterBills) add("ar_water", "debit", { customerId: customerOf(b.accountNo).id }, b.amount);
  for (const w of data.waterAccounts) {
    add("customers_deposits", "credit", { customerId: customerOf(w.accountNo).id }, w.deposit);
    add("customers_advances", "credit", { customerId: customerOf(w.accountNo).id }, w.advance);
  }
  for (const s of data.suppliers) add("accounts_payable_trade", "credit", { supplierId: supplierIds.get(s.name.toUpperCase()) }, s.balance);

  const control = new Set(rec.rows.map((r) => r.accountId));
  const lines: LineInput[] = [];
  for (const t of data.tb) {
    if (control.has(t.accountId)) continue;
    lines.push(t.debit > 0n ? { accountId: t.accountId, debit: t.debit } : { accountId: t.accountId, credit: t.credit });
  }
  const accountOf = new Map<string, string>();
  for (const l of subLines.values()) {
    if (!accountOf.has(l.key)) accountOf.set(l.key, await accountIdFor(l.key, tx));
    lines.push({ accountId: accountOf.get(l.key)!, [l.side]: l.amount, ...l.tag });
  }
  // Merchandise Inventory: the stock count at cost (no subsidiary tag); taken from the trial balance, which equals it.
  const inventory = rec.rows.find((r) => r.keys.includes("merchandise_inventory"));
  if (inventory && inventory.tb !== 0n) lines.push({ accountId: inventory.accountId, debit: inventory.tb });

  const je = await postJournal(
    tx,
    { date: cutoff, book: "GJ", particulars: `Opening balances as of ${formatDate(cutoff)} (data migration)`, reference: ref, source: { module: "migration", id: cutoff }, lines },
    actorId,
  );

  // 3. The records.
  for (const m of data.members) {
    if (m.membershipFee > 0n) await recordMigratedMembershipFee(tx, { memberId: memberId(m.memberNo), amount: m.membershipFee, paidAt: m.membershipDate, jeId: je.id }, actorId);
  }
  for (const s of data.share) await migrateShareCapital(tx, { memberId: memberId(s.memberNo), subscribed: s.subscribed, paidUp: s.paidUp, date: cutoff, jeId: je.id, ref }, actorId);

  const savingsOf = new Map<string, Array<{ id: string; accountNo: string }>>();
  const productsUsed = new Set<string>();
  for (const s of data.savings) {
    const product = depositByCode.get(s.productCode);
    if (!product) throw new MigrationError(`Savings product ${s.productCode} not found`);
    const a = await openMigratedAccount(
      tx,
      { memberId: memberId(s.memberNo), productId: product.id, accountNo: s.accountNo, openedAt: s.openedOn, lastTxnAt: s.lastTxnDate ?? cutoff, balance: s.balance, date: cutoff, jeId: je.id, ref },
      actorId,
    );
    savingsOf.set(s.memberNo, [...(savingsOf.get(s.memberNo) ?? []), a]);
    productsUsed.add(product.id);
  }
  for (const productId of productsUsed) await markInterestMigratedThrough(tx, productId, quarterEndThrough(cutoff), actorId);

  for (const t of data.timeDeposits) {
    if (!tdProduct) throw new MigrationError("No time deposit product in the MIS");
    const id = memberId(t.memberNo);
    let own = savingsOf.get(t.memberNo) ?? [];
    if (own.length === 0 || t.savingsAccountNo) {
      const live = await tx
        .select({ id: depositAccounts.id, accountNo: depositAccounts.accountNo })
        .from(depositAccounts)
        .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
        .where(eq(depositAccounts.memberId, id));
      own = [...own, ...live.filter((a) => !own.some((o) => o.id === a.id))];
    }
    const savings = t.savingsAccountNo ? own.find((a) => a.accountNo.toUpperCase() === t.savingsAccountNo) : own.length === 1 ? own[0] : undefined;
    if (!savings) throw new MigrationError(`Time deposit of ${t.memberNo}: the savings account to pay into wasn't found`);
    await migrateTimeDeposit(
      tx,
      {
        memberId: id,
        productId: tdProduct.id,
        savingsAccountId: savings.id,
        certificateNo: t.certificateNo,
        principal: t.principal,
        ratePa: t.ratePa,
        termDays: t.termDays,
        placementDate: t.placementDate,
        maturityDate: t.maturityDate,
        date: cutoff,
        jeId: je.id,
        ref,
      },
      actorId,
    );
  }

  for (const l of data.loans) {
    const product = loanByCode.get(l.productCode);
    if (!product) throw new MigrationError(`Loan product ${l.productCode} not found`);
    await migrateLoan(
      tx,
      {
        memberId: memberId(l.memberNo),
        product,
        loanNo: l.loanNo,
        principal: l.principal,
        term: l.term,
        ratePm: l.ratePm,
        releaseDate: l.releaseDate,
        firstDueDate: l.firstDueDate,
        installmentsPaid: l.installmentsPaid,
        outstanding: l.outstandingPrincipal,
        unpaidPenalty: l.unpaidPenalty,
        cutoff,
        jeId: je.id,
      },
      actorId,
    );
  }

  const routes = new Map(
    (await tx.select({ id: waterRoutes.id, code: waterRoutes.code, zoneId: waterRoutes.zoneId, zone: waterZones.code }).from(waterRoutes).innerJoin(waterZones, eq(waterZones.id, waterRoutes.zoneId))).map((r) => [
      `${r.zone.toUpperCase()}|${r.code.toUpperCase()}`,
      r,
    ]),
  );
  const accounts = new Map<string, { account: WaterAccount; zoneId: number }>();
  for (const [no, live] of liveAccounts) {
    const [r] = await tx.select({ zoneId: waterRoutes.zoneId }).from(waterRoutes).where(eq(waterRoutes.id, live.account.routeId));
    accounts.set(no, { account: live.account, zoneId: r?.zoneId ?? 0 });
  }
  for (const w of data.waterAccounts) {
    const route = routes.get(`${w.zoneCode}|${w.routeCode}`);
    if (!route) throw new MigrationError(`Route ${w.routeCode} in zone ${w.zoneCode} not found`);
    const bills = data.waterBills.filter((b) => b.accountNo === w.accountNo);
    const account = await createMigratedAccount(
      tx,
      {
        accountNo: w.accountNo,
        customerId: customerOf(w.accountNo).id,
        classification: w.classification as Classification,
        routeId: route.id,
        sequenceNo: w.sequenceNo,
        serviceAddress: w.serviceAddress,
        status: w.status === "DISCONNECTED" ? "DISCONNECTED" : "ACTIVE",
        connectedAt: w.connectedOn,
        deposit: w.deposit,
        meterSerial: w.meterSerial,
        meterDigits: w.meterDigits,
        lastReading: w.lastReading,
        consumption: [w.consumption1, w.consumption2, w.consumption3],
        arrears: { amount: bills.reduce((t, b) => t + b.amount, 0n), bills: bills.length },
        cutoff,
        ref,
      },
      actorId,
    );
    accounts.set(w.accountNo, { account, zoneId: route.zoneId });
  }
  for (const b of data.waterBills) {
    const a = accounts.get(b.accountNo);
    if (!a) throw new MigrationError(`Water account ${b.accountNo} not found`);
    await createMigratedBill(
      tx,
      {
        account: a.account,
        customer: customerOf(b.accountNo),
        zoneId: a.zoneId,
        period: b.period,
        billNo: b.billNo,
        billDate: b.billDate,
        dueDate: b.dueDate,
        consumption: b.consumption,
        amount: b.amount,
        penaltyAssessed: b.penaltyAssessed,
        jeId: je.id,
      },
      actorId,
    );
  }

  const stockBatch = data.batches.find((b) => b.entity === "store_stock");
  let stockTotal = 0n;
  for (const s of data.stock) {
    stockTotal += (await migrateStockItem(tx, s, { date: cutoff, refId: stockBatch?.id ?? je.id, jeId: je.id }, actorId)).value;
  }
  if (stockTotal !== (inventory?.tb ?? 0n)) throw new MigrationError(`The stock counted at cost (${format(stockTotal)}) doesn't equal Merchandise Inventory (${format(inventory?.tb ?? 0n)})`);
  for (const a of data.storeAr) {
    if (a.chargeLimit !== null) await setChargeLimit(tx, { memberId: memberId(a.memberNo), limit: a.chargeLimit }, actorId);
  }

  // 4. The books start here.
  const closed = await closeThroughCutoff(tx, cutoff, ref, actorId);
  const ids = data.batches.map((b) => b.id);
  await tx.update(importBatches).set({ status: "POSTED", postedAt: now(), jeId: je.id }).where(inArray(importBatches.id, ids));
  const counts = {
    members: data.members.length,
    shareCapital: data.share.length,
    savings: data.savings.length,
    timeDeposits: data.timeDeposits.length,
    loans: data.loans.length,
    waterAccounts: data.waterAccounts.length,
    waterBills: data.waterBills.length,
    storeItems: data.stock.length,
    suppliers: data.suppliers.length,
    storeCharges: data.storeAr.length,
    lines: lines.length,
    monthsClosed: closed.months,
  };
  await audit(tx, { action: "migration.post", entity: "journal_entry", entityId: je.id, after: { cutoff, jeNo: je.jeNo, batches: ids.length, ...counts }, userId: actorId });
  return { jeId: je.id, jeNo: je.jeNo ?? "", counts };
}
