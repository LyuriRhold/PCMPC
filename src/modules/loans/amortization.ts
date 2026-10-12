import Decimal from "decimal.js";
import { addMonths, type BusinessDate } from "@/lib/dates";
import { divide, mulRate, mulRateRatio, type Money } from "@/lib/money";

/**
 * Loan amortization (PHASE-10 T10.2/T10.3), pure functions. DOMAIN §3: each row's interest and the
 * amortization are rounded HALF-UP to the centavo; the last installment absorbs the residue so the
 * principal sums exactly to the loan; due dates are firstDueDate + k calendar months (clamped).
 */

export type AmortizationMethod = "DIMINISHING_EQUAL_AMORT" | "DIMINISHING_EQUAL_PRINCIPAL" | "ADD_ON";

export type ScheduleRow = { no: number; dueDate: BusinessDate; principal: Money; interest: Money; payment: Money; balance: Money };

export type ScheduleInput = { principal: Money; ratePm: string; term: number; method: AmortizationMethod; firstDueDate: BusinessDate };

const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

function check(input: ScheduleInput): void {
  if (input.principal <= 0n) throw new Error("The loan amount must be more than zero");
  if (!Number.isInteger(input.term) || input.term < 1 || input.term > 360) throw new Error("The term must be 1 to 360 months");
  if (!/^\d+(\.\d+)?$/.test(input.ratePm)) throw new Error(`Invalid monthly rate "${input.ratePm}"`);
}

/** The level amortization A = P·r ÷ (1 − (1+r)^−n), rounded HALF-UP to the centavo (P ÷ n when r = 0). */
export function levelPayment(principal: Money, ratePm: string, term: number): Money {
  const r = new D(ratePm);
  if (r.isZero()) return divide(principal, BigInt(term));
  const a = new D(principal.toString()).mul(r).div(new D(1).minus(r.plus(1).pow(-term)));
  return BigInt(a.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

/** The repayment schedule: one row per month with principal, interest, payment and the principal balance after it. */
export function schedule(input: ScheduleInput): ScheduleRow[] {
  check(input);
  const { principal: P, ratePm, term: n, firstDueDate } = input;
  const rows: ScheduleRow[] = [];
  const dueDate = (k: number) => addMonths(firstDueDate, k);

  if (input.method === "DIMINISHING_EQUAL_AMORT") {
    const A = levelPayment(P, ratePm, n);
    let balance = P;
    for (let k = 0; k < n; k++) {
      const interest = mulRate(balance, ratePm);
      const last = k === n - 1;
      // The last row pays off whatever is left (the rounding residue).
      const principal = last ? balance : A - interest > balance ? balance : A - interest;
      balance -= principal;
      rows.push({ no: k + 1, dueDate: dueDate(k), principal, interest, payment: principal + interest, balance });
    }
    return rows;
  }

  if (input.method === "DIMINISHING_EQUAL_PRINCIPAL") {
    const each = divide(P, BigInt(n));
    let balance = P;
    for (let k = 0; k < n; k++) {
      const interest = mulRate(balance, ratePm); // on the opening balance
      const principal = k === n - 1 ? balance : each;
      balance -= principal;
      rows.push({ no: k + 1, dueDate: dueDate(k), principal, interest, payment: principal + interest, balance });
    }
    return rows;
  }

  // ADD_ON: total interest P × r × n up front; equal payments of (P + I) ÷ n; the last row absorbs the residue.
  const totalInterest = mulRateRatio(P, ratePm, BigInt(n), 1n);
  const payment = divide(P + totalInterest, BigInt(n));
  const interestEach = divide(totalInterest, BigInt(n));
  let balance = P;
  let paid = 0n;
  let interestPaid = 0n;
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    const pay = last ? P + totalInterest - paid : payment;
    const interest = last ? totalInterest - interestPaid : interestEach;
    const principal = pay - interest;
    balance -= principal;
    paid += pay;
    interestPaid += interest;
    rows.push({ no: k + 1, dueDate: dueDate(k), principal, interest, payment: pay, balance });
  }
  return rows;
}

export type ScheduleTotals = { principal: Money; interest: Money; payment: Money; regularPayment: Money };

export function scheduleTotals(rows: ScheduleRow[]): ScheduleTotals {
  return {
    principal: rows.reduce((s, r) => s + r.principal, 0n),
    interest: rows.reduce((s, r) => s + r.interest, 0n),
    payment: rows.reduce((s, r) => s + r.payment, 0n),
    regularPayment: rows[0]?.payment ?? 0n,
  };
}

// ── Net proceeds (T10.3) ──

export type Deduction = { code: string; name: string; basis: "PCT_OF_PRINCIPAL" | "FIXED"; value: string; glKey?: string };
export type DeductionAmount = { code: string; name: string; amount: Money; glKey: string };

/**
 * The deductions taken from the principal on release (a percentage, rounded HALF-UP, or a fixed
 * amount in centavos) and the net proceeds the member receives.
 */
export function netProceeds(principal: Money, deductions: Deduction[]): { lines: DeductionAmount[]; total: Money; net: Money } {
  const lines = deductions.map((d) => {
    if (d.basis === "FIXED" && !/^\d+$/.test(d.value)) throw new Error(`Invalid fixed deduction "${d.value}"`);
    const amount = d.basis === "PCT_OF_PRINCIPAL" ? mulRate(principal, d.value) : BigInt(d.value);
    return { code: d.code, name: d.name, amount, glKey: d.glKey ?? "" };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0n);
  if (total > principal) throw new Error("The deductions are more than the loan amount");
  return { lines, total, net: principal - total };
}

// ── Effective interest rate (disclosure, RA 3765) ──

/**
 * The effective monthly rate i that makes the net proceeds equal the present value of the
 * installments (Σ payment_k ÷ (1 + i)^k, k = 1…n), by bisection; as a decimal string rounded to
 * 6 places. 0 when the installments don't exceed the net proceeds.
 */
export function effectiveMonthlyRate(net: Money, payments: Money[]): string {
  const total = payments.reduce((s, p) => s + p, 0n);
  if (net <= 0n || total <= net) return "0";
  const target = new D(net.toString());
  const pv = (i: Decimal) => payments.reduce((s, p, k) => s.plus(new D(p.toString()).div(i.plus(1).pow(k + 1))), new D(0));
  let lo = new D(0);
  let hi = new D(1);
  while (pv(hi).gt(target)) hi = hi.mul(2);
  for (let k = 0; k < 200; k++) {
    const mid = lo.plus(hi).div(2);
    if (pv(mid).gt(target)) lo = mid;
    else hi = mid;
  }
  return lo.plus(hi).div(2).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed();
}
