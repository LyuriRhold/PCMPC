import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { businessToday } from "@/lib/dates";
import { divide, format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { users } from "@/modules/auth/schema";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { getSetting } from "@/modules/settings/service";
import { memberChargeLimits, posShifts, products, saleLines, saleReturnLines, saleReturns, sales, type PosShift, type RefundMode, type SalePayment } from "./schema";
import { planStockMoves, recordStockMoves, StoreError } from "./service";
import { costOf } from "./stock";

/**
 * The point of sale (PHASE-13): cashier shifts, cash and member-charge sales, voids, returns and the
 * Z-reading. A sale is one Sales Journal entry with its stock moves, in one transaction: Dr Cash
 * (cash) or AR–Members tagged with the member (charge) / Cr Sales; Dr COGS / Cr Merchandise
 * Inventory at the moving average (DOMAIN §6). Prices come from the item master, never the screen.
 */

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;
const MAX_LINE_QTY = 100_000;

// ── Shifts ──

/** Opens the cashier's POS shift for today with the opening (change) fund. */
export async function openShift(tx: Tx, input: { openingFund: Money }, cashierId: string) {
  if (input.openingFund < 0n) throw new StoreError("The opening fund can't be negative");
  const [open] = await tx.select().from(posShifts).where(and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, "OPEN")));
  if (open) throw new StoreError(open.businessDate === businessToday() ? "Your shift is already open" : "Close your shift from an earlier day first");
  const [s] = await tx.insert(posShifts).values({ cashierId, businessDate: businessToday(), openingFund: input.openingFund, createdBy: cashierId }).returning();
  if (!s) throw new Error("shift insert returned no row");
  await audit(tx, { action: "store.shift_open", entity: "pos_shift", entityId: s.id, after: { openingFund: format(input.openingFund) }, userId: cashierId });
  return { id: s.id };
}

/** The cashier's open shift, if any. */
export async function currentShift(cashierId: string, db: Db | Tx = getDb()): Promise<PosShift | null> {
  const [s] = await db.select().from(posShifts).where(and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, "OPEN")));
  return s ?? null;
}

/** The cashier's open shift for today, locked against closing while a sale is recorded. */
async function requireOpenShift(tx: Tx, cashierId: string): Promise<PosShift> {
  const [s] = await tx.select().from(posShifts).where(and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, "OPEN"))).for("share");
  if (!s) throw new StoreError("Open your shift first");
  if (s.businessDate !== businessToday()) throw new StoreError("Close your shift from an earlier day first");
  return s;
}

// ── Member charge accounts ──

/** A member's store credit limit: their own, else store.member_credit_limit. */
export async function chargeLimit(memberId: string, db: Db | Tx = getDb()): Promise<{ limit: Money; own: boolean }> {
  const [own] = await db.select({ limit: memberChargeLimits.limitAmount }).from(memberChargeLimits).where(eq(memberChargeLimits.memberId, memberId));
  if (own) return { limit: own.limit, own: true };
  return { limit: BigInt(await getSetting("store.member_credit_limit", db)), own: false };
}

/** What a member owes the store (AR–Members, the member's posted lines). */
export async function memberAr(memberId: string, db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, and(eq(accountMappings.accountId, journalLines.accountId), eq(accountMappings.key, "accounts_receivable_members")))
    .where(and(eq(journalLines.memberId, memberId), inArray(journalEntries.status, ["POSTED", "REVERSED"])));
  return BigInt(r?.s ?? "0");
}

/** A member's limit, balance and what they can still charge. */
export async function chargeAvailable(memberId: string, db: Db | Tx = getDb()) {
  const [{ limit, own }, balance] = await Promise.all([chargeLimit(memberId, db), memberAr(memberId, db)]);
  const available = limit - balance;
  return { limit, own, balance, available: available > 0n ? available : 0n };
}

// ── Sales ──

export type SaleLineInput = { productId: string; qty: number };

/** The lines at today's selling prices (from the item master). */
async function priceLines(tx: Tx, lines: SaleLineInput[], opts: { activeOnly: boolean }) {
  if (lines.length === 0) throw new StoreError("Scan or add at least one item");
  if (lines.length > 200) throw new StoreError("A sale has at most 200 lines");
  const rows = await tx.select().from(products).where(inArray(products.id, [...new Set(lines.map((l) => l.productId))]));
  const byId = new Map(rows.map((p) => [p.id, p]));
  return lines.map((l, i) => {
    const p = byId.get(l.productId);
    if (!p) throw new StoreError(`Line ${i + 1}: product not found`);
    if (opts.activeOnly && !p.isActive) throw new StoreError(`${p.sku} ${p.name} is no longer sold`);
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > MAX_LINE_QTY) throw new StoreError(`${p.sku}: the quantity is a whole number from 1 to 100,000`);
    return { product: p, qty: l.qty, unitPrice: p.sellingPrice, lineTotal: BigInt(l.qty) * p.sellingPrice };
  });
}

/** The member on a sale: ACTIVE (store patronage is for members only). Locked for a charge, so its limit check can't race. */
async function saleMember(tx: Tx, memberId: string, lock: boolean): Promise<MemberRow> {
  const q = tx.select().from(members).where(eq(members.id, memberId));
  const [m] = lock ? await q.for("update") : await q;
  if (!m) throw new StoreError("Member not found");
  if (m.status !== "ACTIVE" || !m.memberNo) throw new StoreError(`${nameOf(m)} is not an ACTIVE member`);
  return m;
}

/**
 * Completes a sale at the cashier's open shift. Cash: the amount tendered covers the total and the
 * change is given. Charge: an ACTIVE member only, and what they owe plus this sale stays within
 * their credit limit.
 */
export async function completeSale(tx: Tx, input: { memberId: string | null; payment: SalePayment; lines: SaleLineInput[]; tendered: Money | null; birInvoiceNo: string | null }, cashierId: string) {
  const shift = await requireOpenShift(tx, cashierId);
  if (input.payment === "CHARGE" && !input.memberId) throw new StoreError("Charge sales are for members only: choose the member");
  const member = input.memberId ? await saleMember(tx, input.memberId, input.payment === "CHARGE") : null;
  const priced = await priceLines(tx, input.lines, { activeOnly: true });
  const total = priced.reduce((s, l) => s + l.lineTotal, 0n);
  if (total <= 0n) throw new StoreError("The sale's total must be more than zero");

  let tendered: Money | null = null;
  let change: Money | null = null;
  if (input.payment === "CHARGE" && member) {
    const { limit, balance } = await chargeAvailable(member.id, tx);
    if (balance + total > limit) {
      const available = limit - balance;
      throw new StoreError(`Exceeds credit limit (available ${format(available > 0n ? available : 0n)})`);
    }
  } else {
    if (input.tendered === null) throw new StoreError("Enter the amount tendered");
    if (input.tendered < total) throw new StoreError(`The amount tendered (${format(input.tendered)}) is less than the total (${format(total)})`);
    tendered = input.tendered;
    change = input.tendered - total;
  }

  const plans = await planStockMoves(
    tx,
    priced.map((l) => ({ productId: l.product.id, type: "SALE" as const, qty: -l.qty })),
  );
  const cogs = plans.reduce((s, p) => s - p.totalCost, 0n);
  const today = businessToday();
  const saleId = randomUUID();
  const saleNo = await nextNumber("S", tx, today);
  const lines: LineInput[] = [
    member && input.payment === "CHARGE"
      ? { accountId: await accountIdFor("accounts_receivable_members", tx), debit: total, memberId: member.id, memo: saleNo }
      : { accountId: await accountIdFor("cash_on_hand", tx), debit: total, memo: saleNo },
    { accountId: await accountIdFor("sales", tx), credit: total, memo: saleNo },
  ];
  if (cogs > 0n) {
    lines.push({ accountId: await accountIdFor("cost_of_sales", tx), debit: cogs, memo: saleNo }, { accountId: await accountIdFor("merchandise_inventory", tx), credit: cogs, memo: saleNo });
  }
  const birInvoiceNo = input.birInvoiceNo?.trim() || null;
  const je = await postJournal(
    tx,
    {
      date: today,
      book: "SJ",
      particulars: `${saleNo} · ${member ? `${member.memberNo} ${nameOf(member)}` : "walk-in"} · ${input.payment === "CHARGE" ? "charge" : "cash"}`,
      reference: birInvoiceNo ?? saleNo,
      source: { module: "store", id: saleId },
      lines,
    },
    cashierId,
  );
  await tx.insert(sales).values({
    id: saleId,
    saleNo,
    shiftId: shift.id,
    saleDate: today,
    cashierId,
    memberId: member?.id ?? null,
    customerType: member ? "MEMBER" : "NON_MEMBER",
    payment: input.payment,
    subtotal: total,
    total,
    tendered,
    change,
    status: "COMPLETED",
    jeId: je.id,
    birInvoiceNo,
    createdBy: cashierId,
  });
  await tx.insert(saleLines).values(
    priced.map((l, i) => ({ saleId, lineNo: i + 1, productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, unitCost: plans[i]!.unitCost, cogs: -plans[i]!.totalCost, createdBy: cashierId })),
  );
  await recordStockMoves(tx, plans, { date: today, refType: "SALE", refId: saleId, jeId: je.id }, cashierId);
  await audit(tx, { action: "store.sale", entity: "sale", entityId: saleId, after: { saleNo, payment: input.payment, total: format(total), member: member?.memberNo ?? null }, userId: cashierId });
  return { id: saleId, saleNo, jeId: je.id, total, change };
}

/**
 * Voids a sale before it is completed (e.g. the customer left): kept with its lines and number for
 * the audit trail, with the supervisor who allowed it (verified by credential) and the reason. No
 * entry, no stock.
 */
export async function voidSale(tx: Tx, input: { memberId: string | null; payment: SalePayment; lines: SaleLineInput[]; reason: string }, cashierId: string, supervisorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new StoreError("Enter why the sale is voided");
  assertNotSameUser(cashierId, supervisorId);
  const shift = await requireOpenShift(tx, cashierId);
  const member = input.memberId ? await saleMember(tx, input.memberId, false) : null;
  const payment: SalePayment = member ? input.payment : "CASH";
  const priced = await priceLines(tx, input.lines, { activeOnly: false });
  const total = priced.reduce((s, l) => s + l.lineTotal, 0n);
  const today = businessToday();
  const saleNo = await nextNumber("S", tx, today);
  const [sale] = await tx
    .insert(sales)
    .values({
      saleNo,
      shiftId: shift.id,
      saleDate: today,
      cashierId,
      memberId: member?.id ?? null,
      customerType: member ? "MEMBER" : "NON_MEMBER",
      payment,
      subtotal: total,
      total,
      status: "VOIDED",
      voidedBy: supervisorId,
      voidReason: reason,
      createdBy: cashierId,
    })
    .returning();
  if (!sale) throw new Error("sale insert returned no row");
  await tx.insert(saleLines).values(priced.map((l, i) => ({ saleId: sale.id, lineNo: i + 1, productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, unitCost: "0", cogs: 0n, createdBy: cashierId })));
  await audit(tx, { action: "store.sale_void", entity: "sale", entityId: sale.id, after: { saleNo, total: format(total), reason, supervisor: supervisorId }, userId: cashierId });
  return { id: sale.id, saleNo };
}

/** A sale with its member, lines (and what was already returned of each) and returns. */
export async function getSale(saleId: string, db: Db | Tx = getDb()) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId));
  if (!sale) return null;
  const [member] = sale.memberId ? await db.select().from(members).where(eq(members.id, sale.memberId)) : [];
  const lineRows = await db
    .select({ line: saleLines, product: { sku: products.sku, name: products.name, unit: products.unit, barcode: products.barcode } })
    .from(saleLines)
    .innerJoin(products, eq(products.id, saleLines.productId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(saleLines.lineNo));
  const returns = await db.select().from(saleReturns).where(eq(saleReturns.saleId, saleId)).orderBy(asc(saleReturns.returnNo));
  const returned = returns.length
    ? await db
        .select({ saleLineId: saleReturnLines.saleLineId, qty: sql<number>`sum(${saleReturnLines.qty})::int`, cost: sql<string>`sum(${saleReturnLines.cost})::text` })
        .from(saleReturnLines)
        .where(inArray(saleReturnLines.returnId, returns.map((r) => r.id)))
        .groupBy(saleReturnLines.saleLineId)
    : [];
  const byLine = new Map(returned.map((r) => [r.saleLineId, r]));
  return {
    sale,
    member: member ?? null,
    lines: lineRows.map(({ line, product }) => ({ ...line, ...product, returnedQty: byLine.get(line.id)?.qty ?? 0, returnedCost: BigInt(byLine.get(line.id)?.cost ?? "0") })),
    returns,
  };
}

/** A shift's sales, newest first. */
export async function shiftSales(shiftId: string, db: Db | Tx = getDb()) {
  return db
    .select({ sale: sales, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName })
    .from(sales)
    .leftJoin(members, eq(members.id, sales.memberId))
    .where(eq(sales.shiftId, shiftId))
    .orderBy(desc(sales.saleNo));
}

/**
 * A member's store patronage for a year (for the patronage refund, Phase 15): their completed
 * purchases, cash and charge, less what they returned in the year.
 */
export async function storePatronage(memberId: string, year: number, db: Db | Tx = getDb()): Promise<Money> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [bought] = await db
    .select({ s: sql<string>`coalesce(sum(${sales.total}), 0)::text` })
    .from(sales)
    .where(and(eq(sales.memberId, memberId), eq(sales.status, "COMPLETED"), gte(sales.saleDate, from), lte(sales.saleDate, to)));
  const [back] = await db
    .select({ s: sql<string>`coalesce(sum(${saleReturns.total}), 0)::text` })
    .from(saleReturns)
    .innerJoin(sales, eq(sales.id, saleReturns.saleId))
    .where(and(eq(sales.memberId, memberId), gte(saleReturns.returnDate, from), lte(saleReturns.returnDate, to)));
  return BigInt(bought?.s ?? "0") - BigInt(back?.s ?? "0");
}

// ── Returns (T13.3) ──

/**
 * Goods returned from a completed sale (not more than was sold less earlier returns): restocked at
 * the sale's unit cost (the last units of a line take what is left of its COGS, so nothing drifts),
 * refunded in cash from the cashier's open drawer, or, for a charge sale, taken off the member's
 * account (up to what they owe). One entry: Dr Sales Returns / Cr Cash or AR–Members; Dr Merchandise
 * Inventory / Cr COGS.
 */
export async function returnSale(tx: Tx, input: { saleId: string; lines: Array<{ saleLineId: string; qty: number }>; refundMode: RefundMode; reason: string }, cashierId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new StoreError("Enter why the goods are returned");
  const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for("update");
  if (!sale) throw new StoreError("Sale not found");
  if (sale.status !== "COMPLETED") throw new StoreError(`${sale.saleNo} was voided; nothing to return`);
  if (input.lines.length === 0) throw new StoreError("Choose what is returned");
  if (input.refundMode === "AR" && (sale.payment !== "CHARGE" || !sale.memberId)) throw new StoreError("Only a charge sale is refunded to the member's account");
  const shift = input.refundMode === "CASH" ? await requireOpenShift(tx, cashierId) : await currentShift(cashierId, tx);
  const detail = (await getSale(sale.id, tx))!;
  const byId = new Map(detail.lines.map((l) => [l.id, l]));
  const wanted = new Map<string, number>();
  for (const l of input.lines) {
    if (!byId.has(l.saleLineId)) throw new StoreError(`That item isn't on ${sale.saleNo}`);
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new StoreError("A returned quantity is a whole number more than zero");
    wanted.set(l.saleLineId, (wanted.get(l.saleLineId) ?? 0) + l.qty);
  }
  const lines = [...wanted].map(([saleLineId, qty]) => {
    const l = byId.get(saleLineId)!;
    const left = l.qty - l.returnedQty;
    if (qty > left) throw new StoreError(`${l.sku} ${l.name}: only ${left} of ${l.qty} can still be returned`);
    const amount = BigInt(qty) * l.unitPrice - (l.discount === 0n ? 0n : divide(l.discount * BigInt(qty), BigInt(l.qty)));
    const cost = qty === left ? l.cogs - l.returnedCost : costOf(qty, l.unitCost);
    return { line: l, qty, amount, cost: cost > 0n ? cost : 0n };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0n);
  const cost = lines.reduce((s, l) => s + l.cost, 0n);
  if (total <= 0n) throw new StoreError("Nothing to refund");
  if (input.refundMode === "AR" && sale.memberId) {
    const owed = await memberAr(sale.memberId, tx);
    if (total > owed) throw new StoreError(`The member owes ${format(owed > 0n ? owed : 0n)}; refund the rest in cash`);
  }

  const plans = await planStockMoves(
    tx,
    lines.map((l) => ({ productId: l.line.productId, type: "RETURN" as const, qty: l.qty, cost: l.cost })),
  );
  const today = businessToday();
  const returnId = randomUUID();
  const returnNo = await nextNumber("SR", tx, today);
  const je = await postJournal(
    tx,
    {
      date: today,
      book: "SJ",
      particulars: `${returnNo} · return on ${sale.saleNo} · ${input.refundMode === "CASH" ? "cash refund" : "credited to the member's account"}: ${reason}`,
      reference: returnNo,
      source: { module: "store", id: returnId },
      lines: [
        { accountId: await accountIdFor("sales_returns", tx), debit: total, memo: returnNo },
        input.refundMode === "AR"
          ? { accountId: await accountIdFor("accounts_receivable_members", tx), credit: total, memberId: sale.memberId, memo: returnNo }
          : { accountId: await accountIdFor("cash_on_hand", tx), credit: total, memo: returnNo },
        ...(cost > 0n
          ? [
              { accountId: await accountIdFor("merchandise_inventory", tx), debit: cost, memo: returnNo },
              { accountId: await accountIdFor("cost_of_sales", tx), credit: cost, memo: returnNo },
            ]
          : []),
      ],
    },
    cashierId,
  );
  await tx.insert(saleReturns).values({ id: returnId, returnNo, saleId: sale.id, shiftId: shift?.id ?? null, returnDate: today, refundMode: input.refundMode, total, cost, reason, cashierId, jeId: je.id, createdBy: cashierId });
  await tx.insert(saleReturnLines).values(
    lines.map((l) => ({ returnId, saleLineId: l.line.id, productId: l.line.productId, qty: l.qty, unitPrice: l.line.unitPrice, amount: l.amount, unitCost: l.line.unitCost, cost: l.cost, createdBy: cashierId })),
  );
  await recordStockMoves(tx, plans, { date: today, refType: "RETURN", refId: returnId, jeId: je.id }, cashierId);
  await audit(tx, { action: "store.sale_return", entity: "sale", entityId: sale.id, after: { returnNo, total: format(total), cost: format(cost), refundMode: input.refundMode, reason }, userId: cashierId });
  return { id: returnId, returnNo, jeId: je.id, total };
}

// ── Z-reading, closing and verification (T13.4) ──

/**
 * A shift's reading: sales and returns, cash and charge, and the cash that should be in the
 * drawer (opening fund + cash sales − cash refunds). The Z-reading is this reading kept at close.
 */
export async function shiftReading(shiftId: string, db: Db | Tx = getDb()) {
  const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId));
  if (!shift) throw new StoreError("Shift not found");
  const [s] = await db
    .select({
      count: sql<number>`count(*) FILTER (WHERE ${sales.status} = 'COMPLETED')::int`,
      voids: sql<number>`count(*) FILTER (WHERE ${sales.status} = 'VOIDED')::int`,
      gross: sql<string>`coalesce(sum(${sales.total}) FILTER (WHERE ${sales.status} = 'COMPLETED'), 0)::text`,
      cash: sql<string>`coalesce(sum(${sales.total}) FILTER (WHERE ${sales.status} = 'COMPLETED' AND ${sales.payment} = 'CASH'), 0)::text`,
      charge: sql<string>`coalesce(sum(${sales.total}) FILTER (WHERE ${sales.status} = 'COMPLETED' AND ${sales.payment} = 'CHARGE'), 0)::text`,
    })
    .from(sales)
    .where(eq(sales.shiftId, shiftId));
  const [r] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${saleReturns.total}), 0)::text`,
      cash: sql<string>`coalesce(sum(${saleReturns.total}) FILTER (WHERE ${saleReturns.refundMode} = 'CASH'), 0)::text`,
      ar: sql<string>`coalesce(sum(${saleReturns.total}) FILTER (WHERE ${saleReturns.refundMode} = 'AR'), 0)::text`,
    })
    .from(saleReturns)
    .where(eq(saleReturns.shiftId, shiftId));
  const grossSales = BigInt(s?.gross ?? "0");
  const cashSales = BigInt(s?.cash ?? "0");
  const returns = BigInt(r?.total ?? "0");
  const cashRefunds = BigInt(r?.cash ?? "0");
  return {
    shift,
    openingFund: shift.openingFund,
    salesCount: s?.count ?? 0,
    voidsCount: s?.voids ?? 0,
    returnsCount: r?.count ?? 0,
    grossSales,
    cashSales,
    chargeSales: BigInt(s?.charge ?? "0"),
    returns,
    cashRefunds,
    arRefunds: BigInt(r?.ar ?? "0"),
    netSales: grossSales - returns,
    netCashSales: cashSales - cashRefunds,
    expectedCash: shift.openingFund + cashSales - cashRefunds,
  };
}

/** The cashier closes their shift with the cash counted; the Z-reading is kept. */
export async function closeShift(tx: Tx, input: { shiftId: string; countedCash: Money }, cashierId: string) {
  const [s] = await tx.select().from(posShifts).where(eq(posShifts.id, input.shiftId)).for("update");
  if (!s) throw new StoreError("Shift not found");
  if (s.cashierId !== cashierId) throw new StoreError("Only the cashier who opened the shift can close it");
  if (s.status !== "OPEN") throw new StoreError(`This shift is already ${s.status}`);
  if (input.countedCash < 0n) throw new StoreError("The cash counted can't be negative");
  const z = await shiftReading(s.id, tx);
  const variance = input.countedCash - z.expectedCash;
  const zReading = {
    salesCount: z.salesCount,
    voidsCount: z.voidsCount,
    returnsCount: z.returnsCount,
    openingFund: String(z.openingFund),
    grossSales: String(z.grossSales),
    cashSales: String(z.cashSales),
    chargeSales: String(z.chargeSales),
    returns: String(z.returns),
    cashRefunds: String(z.cashRefunds),
    arRefunds: String(z.arRefunds),
    netSales: String(z.netSales),
    netCashSales: String(z.netCashSales),
    expectedCash: String(z.expectedCash),
    countedCash: String(input.countedCash),
    variance: String(variance),
  };
  await tx.update(posShifts).set({ status: "CLOSED", expectedCash: z.expectedCash, countedCash: input.countedCash, variance, zReading, closedAt: sql`now()` }).where(eq(posShifts.id, s.id));
  await audit(tx, { action: "store.shift_close", entity: "pos_shift", entityId: s.id, after: { expected: format(z.expectedCash), counted: format(input.countedCash), variance: format(variance) }, userId: cashierId });
  return { expectedCash: z.expectedCash, variance };
}

/**
 * The manager (not the cashier) verifies a closed shift; a variance is posted to Cash Short/Over
 * on the shift's business date (short: Dr Short/Over / Cr Cash; over: Dr Cash / Cr Short/Over).
 */
export async function verifyShift(tx: Tx, input: { shiftId: string }, managerId: string) {
  const [s] = await tx.select().from(posShifts).where(eq(posShifts.id, input.shiftId)).for("update");
  if (!s) throw new StoreError("Shift not found");
  if (s.status !== "CLOSED") throw new StoreError(s.status === "OPEN" ? "The cashier closes the shift first" : "This shift is already verified");
  assertNotSameUser(s.cashierId, managerId);
  const variance = s.variance ?? 0n;
  let varianceJeId: string | null = null;
  if (variance !== 0n) {
    const [cash, shortOver] = [await accountIdFor("cash_on_hand", tx), await accountIdFor("cash_short_over", tx)];
    const abs = variance < 0n ? -variance : variance;
    const je = await postJournal(
      tx,
      {
        date: s.businessDate,
        book: "GJ",
        particulars: `Cash ${variance < 0n ? "short" : "over"} of the store POS shift of ${s.businessDate}`,
        source: { module: "store", id: s.id },
        lines:
          variance < 0n
            ? [
                { accountId: shortOver, debit: abs },
                { accountId: cash, credit: abs },
              ]
            : [
                { accountId: cash, debit: abs },
                { accountId: shortOver, credit: abs },
              ],
      },
      managerId,
    );
    varianceJeId = je.id;
  }
  await tx.update(posShifts).set({ status: "VERIFIED", verifiedBy: managerId, verifiedAt: sql`now()`, varianceJeId }).where(eq(posShifts.id, s.id));
  await audit(tx, { action: "store.shift_verify", entity: "pos_shift", entityId: s.id, after: { variance: format(variance), varianceJeId }, userId: managerId });
  return { varianceJeId };
}

/** Shifts, newest first, with their cashier. */
export async function listShifts(filter: { status?: "OPEN" | "CLOSED" | "VERIFIED" } = {}, db: Db | Tx = getDb()) {
  return db
    .select({ shift: posShifts, cashier: users.username })
    .from(posShifts)
    .innerJoin(users, eq(users.id, posShifts.cashierId))
    .where(filter.status ? eq(posShifts.status, filter.status) : undefined)
    .orderBy(desc(posShifts.businessDate), desc(posShifts.createdAt))
    .limit(100);
}
