import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { decideApplicationAction } from "@/modules/loans/actions";
import { netProceeds, schedule } from "@/modules/loans/amortization";
import { getApplication } from "@/modules/loans/service";
import { P } from "../helpers/phase03";
import { applicant as applicantInput, createApplicantAs } from "../helpers/phase02";
import { member } from "../helpers/phase08";
import { apply, committeeId, goodStandingMember, managerId, officerId, setMinPaidUp, setupLoans } from "../helpers/phase10";

beforeEach(async () => {
  await setupLoans();
});
afterEach(() => setClock(null));

const row = (r: { no: number; dueDate: string; principal: bigint; interest: bigint; payment: bigint; balance: bigint } | undefined) => r && { principal: r.principal, interest: r.interest, payment: r.payment, balance: r.balance };

describe("Phase 10 acceptance", () => {
  it("A10.1 DIMINISHING_EQUAL_AMORT ₱10,000.00, 1.5%/mo, 12 months → payment ₱916.80 … total interest ₱1,001.61", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: "2026-11-07" });
    expect(rows).toHaveLength(12);
    expect(row(rows[0])).toEqual({ payment: P(916, 80), interest: P(150), principal: P(766, 80), balance: P(9233, 20) });
    expect(row(rows[1])).toEqual({ payment: P(916, 80), interest: P(138, 50), principal: P(778, 30), balance: P(8454, 90) });
    expect(rows[2]?.interest).toBe(P(126, 82));
    expect(row(rows[11])).toEqual({ payment: P(916, 81), interest: P(13, 55), principal: P(903, 26), balance: 0n });
    expect(rows.reduce((s, r) => s + r.interest, 0n)).toBe(P(1001, 61));
  });

  it("A10.2 ADD_ON ₱10,000.00, 1.5%/mo, 12 months → interest ₱1,800.00; rows 1–11 ₱983.33, row 12 ₱983.37; total ₱11,800.00", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "ADD_ON", firstDueDate: "2026-11-07" });
    expect(rows.reduce((s, r) => s + r.interest, 0n)).toBe(P(1800));
    for (const r of rows.slice(0, 11)) expect(r.payment).toBe(P(983, 33));
    expect(rows[11]?.payment).toBe(P(983, 37));
    expect(rows.reduce((s, r) => s + r.payment, 0n)).toBe(P(11800));
    expect(rows[11]?.balance).toBe(0n);
  });

  it("A10.3 DIMINISHING_EQUAL_PRINCIPAL ₱12,000.00, 1%/mo, 12 months → row 1 ₱1,120.00; row 12 ₱1,010.00; interest ₱780.00", () => {
    const rows = schedule({ principal: P(12000), ratePm: "0.01", term: 12, method: "DIMINISHING_EQUAL_PRINCIPAL", firstDueDate: "2026-11-07" });
    expect(rows[0]?.payment).toBe(P(1120));
    expect(rows[11]?.payment).toBe(P(1010));
    expect(rows.reduce((s, r) => s + r.interest, 0n)).toBe(P(780));
  });

  it("A10.4 net proceeds of ₱10,000.00 with service fee 2%, CBU 2%, notarial ₱100 → 200.00 + 200.00 + 100.00; net ₱9,500.00", () => {
    const r = netProceeds(P(10000), [
      { code: "SERVICE_FEE", name: "Service fee", basis: "PCT_OF_PRINCIPAL", value: "0.02" },
      { code: "CBU", name: "CBU", basis: "PCT_OF_PRINCIPAL", value: "0.02" },
      { code: "NOTARIAL", name: "Notarial fee", basis: "FIXED", value: "10000" },
    ]);
    expect(r.lines.map((l) => [l.code, l.amount])).toEqual([
      ["SERVICE_FEE", P(200)],
      ["CBU", P(200)],
      ["NOTARIAL", P(100)],
    ]);
    expect(r.total).toBe(P(500));
    expect(r.net).toBe(P(9500));
  });

  it("A10.5 paid-up ₱5,000.00 with a 3× multiple, applying for ₱20,000.00 → rejected \"Exceeds loanable amount ₱15,000.00\"", async () => {
    // Payments up to the minimum paid-up are exempt from the 10% holding cap: raise it to ₱5,000.00 for this member.
    await setMinPaidUp("500000");
    const m = await goodStandingMember("Borrower", "5,000.00");
    const comaker = await goodStandingMember("Comaker", "5,000.00");
    const r = await apply({ memberId: m, product: "REG", amount: "20,000.00", term: 12, comakerIds: [comaker] });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Exceeds loanable amount ₱15,000.00") });
  });

  it("A10.6 an APPLICANT, or a member not in good standing, is rejected with the rule's message", async () => {
    const applicant = await createApplicantAs(managerId(), applicantInput({ lastName: "Applicant", firstName: "Ana", birthdate: "1990-03-03", tin: null, validIdNo: "ID-A10" }));
    expect(await apply({ memberId: applicant, product: "EMR", amount: "5,000.00", term: 6 })).toMatchObject({ ok: false, error: expect.stringContaining("Member must be ACTIVE") });
    const notGood = await member("Unpaid");
    expect(await apply({ memberId: notGood, product: "EMR", amount: "5,000.00", term: 6 })).toMatchObject({ ok: false, error: expect.stringContaining("not in good standing") });
  });

  it("A10.7 ₱50,000.00; the manager approves (limit ₱30,000.00) → RECOMMENDED; the Credit Committee approves → APPROVED", async () => {
    const m = await goodStandingMember("Borrower");
    const comaker = await goodStandingMember("Comaker");
    const r = await apply({ memberId: m, product: "PRD", amount: "50,000.00", term: 12, comakerIds: [comaker] });
    if (!r.ok) throw new Error(r.error);
    const byManager = await runAs(managerId(), () => decideApplicationAction({ applicationId: r.data.id, decision: "APPROVE", remarks: "Good repayment capacity" }));
    expect(byManager).toEqual({ ok: true, data: { status: "RECOMMENDED" } });
    expect((await getApplication(r.data.id))?.application.status).toBe("RECOMMENDED");
    const byCommittee = await runAs(committeeId(), () => decideApplicationAction({ applicationId: r.data.id, decision: "APPROVE", remarks: "Approved in CC meeting" }));
    expect(byCommittee).toEqual({ ok: true, data: { status: "APPROVED" } });
    expect((await getApplication(r.data.id))?.application.status).toBe("APPROVED");
  });

  it("A10.8 loan officer lo1 encodes and tries to approve → Forbidden (SoD)", async () => {
    const m = await goodStandingMember();
    const r = await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    await expect(runAs(officerId(), () => decideApplicationAction({ applicationId: r.data.id, decision: "APPROVE", remarks: "" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getApplication(r.data.id))?.application.status).toBe("SUBMITTED");
  });

  it("A10.9 the borrower listed as their own comaker → rejected", async () => {
    const m = await goodStandingMember();
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [m] })).toMatchObject({ ok: false, error: expect.stringContaining("own comaker") });
  });

  it("A10.10 first due date 2026-01-31, monthly → 2026-01-31, 2026-02-28, 2026-03-31 …", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: "2026-01-31" });
    expect(rows.slice(0, 4).map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});
