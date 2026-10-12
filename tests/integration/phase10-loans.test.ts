import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs, SodError } from "@/lib/auth-guard";
import { addMonths, businessToday, setClock } from "@/lib/dates";
import { cancelReceiptAction } from "@/modules/cashiering/actions";
import { changeMemberStatusAction } from "@/modules/members/actions";
import { borrowerLookupAction, cancelApplicationAction, decideApplicationAction, submitApplicationAction, updateLoanProductAction } from "@/modules/loans/actions";
import { registerPastDueHook } from "@/modules/loans/eligibility";
import { decideApplication, getApplication, getLoanProduct, previewLoan } from "@/modules/loans/service";
import { updateSetting } from "@/modules/settings/service";
import { makeUser } from "../helpers/phase01";
import { P } from "../helpers/phase03";
import { member, receipt, subscribe, tellerToday } from "../helpers/phase08";
import { apply, committeeId, goodStandingMember, managerId, officerId, productId, setupLoans } from "../helpers/phase10";

beforeEach(async () => {
  await setupLoans();
});
afterEach(() => {
  setClock(null);
  registerPastDueHook("test", async () => null);
});

const decide = (userId: string, applicationId: string, decision: "APPROVE" | "REJECT", remarks = "") => runAs(userId, () => decideApplicationAction({ applicationId, decision, remarks }));

describe("T10.4 eligibility", () => {
  it("a submitted application keeps the five rule results, the schedule, deductions and net proceeds", async () => {
    const m = await goodStandingMember();
    const r = await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.appNo).toMatch(/^LA-\d{4}-\d{5}$/);
    const app = (await getApplication(r.data.id))!.application;
    expect(app.eligibility.map((e) => [e.rule, e.pass])).toEqual([
      ["member", true],
      ["amount", true],
      ["term", true],
      ["past-due", true],
      ["comakers", true],
    ]);
    expect(app.firstDueDate).toBe(addMonths(businessToday(), 1));
    const preview = previewLoan((await getLoanProduct(app.productId))!, { amount: P(5000), term: 6, firstDueDate: app.firstDueDate });
    expect(app.schedulePreview.map((x) => BigInt(x.payment))).toEqual(preview.rows.map((x) => x.payment));
    expect(app.deductions).toEqual([{ code: "SERVICE_FEE", name: "Service fee", amount: String(P(50)), glKey: "service_fee_income" }]);
    expect(app.netProceeds).toBe(P(4950));
    expect(app.totalInterest).toBe(P(450));
    expect(app.status).toBe("SUBMITTED");
  });

  it("the term and the product maximum are checked", async () => {
    const m = await goodStandingMember();
    expect(await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 7 })).toMatchObject({ ok: false, error: expect.stringContaining("The term must be 1 to 6 months") });
    expect(await apply({ memberId: m, product: "EMR", amount: "10,000.01", term: 6 })).toMatchObject({ ok: false, error: expect.stringContaining("Exceeds loanable amount ₱10,000.00") });
    expect((await apply({ memberId: m, product: "EMR", amount: "10,000.00", term: 6 })).ok).toBe(true);
  });

  it("comakers: the required number, ACTIVE members only, not listed twice", async () => {
    const m = await goodStandingMember("Borrower");
    const c = await goodStandingMember("Comaker");
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12 })).toMatchObject({ ok: false, error: expect.stringContaining("needs 1 comaker") });
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c, c] })).toMatchObject({ ok: false, error: expect.stringContaining("listed twice") });
    expect((await runAs(managerId(), () => changeMemberStatusAction({ memberId: c, to: "INACTIVE", reason: "Moved", ref: null }))).ok).toBe(true);
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c] })).toMatchObject({ ok: false, error: expect.stringMatching(/Comaker .* is INACTIVE/) });
  });

  it("past-due hooks block the borrower and the comakers, unless the setting is off", async () => {
    const m = await goodStandingMember("Borrower");
    const c = await goodStandingMember("Comaker");
    registerPastDueHook("test", async (_db, memberId) => (memberId === c ? "has a past-due loan (LN-2026-00001)" : null));
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c] })).toMatchObject({ ok: false, error: expect.stringContaining("has a past-due loan (LN-2026-00001)") });
    registerPastDueHook("test", async (_db, memberId) => (memberId === m ? "has a past-due loan (LN-2026-00002)" : null));
    expect(await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c] })).toMatchObject({ ok: false, error: expect.stringContaining("LN-2026-00002") });
    await withTx((tx) => updateSetting(tx, "loan.block_if_past_due", false, managerId()));
    expect((await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c] })).ok).toBe(true);
  });

  it("only loan officers submit; the borrower lookup tells whether the member is in good standing", async () => {
    const m = await goodStandingMember("Lookup");
    const teller = await tellerToday();
    await expect(runAs(teller, async () => submitApplicationAction({ memberId: m, productId: await productId("EMR"), amount: "1,000.00", term: 6, purpose: "x", comakerIds: [] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(committeeId(), async () => submitApplicationAction({ memberId: m, productId: await productId("EMR"), amount: "1,000.00", term: 6, purpose: "x", comakerIds: [] }))).rejects.toBeInstanceOf(ForbiddenError);
    const submitted = await apply({ memberId: m, product: "EMR", amount: "1,000.00", term: 6 });
    if (!submitted.ok) throw new Error(submitted.error);
    const memberNo = (await getApplication(submitted.data.id))?.member.memberNo ?? "";
    const found = await runAs(officerId(), () => borrowerLookupAction({ memberNo: memberNo.toLowerCase() }));
    expect(found).toMatchObject({ ok: true, data: { id: m, goodStanding: true, paidUp: String(P(2500)) } });
    expect(await runAs(officerId(), () => borrowerLookupAction({ memberNo: "M-999999" }))).toEqual({ ok: false, error: "No member M-999999" });
  });
});

describe("T10.5 approval matrix and SoD", () => {
  it("up to the ₱30,000.00 limit the manager's approval approves it; the Credit Committee never acts first", async () => {
    const m = await goodStandingMember("Borrower");
    const c = await goodStandingMember("Comaker");
    const r = await apply({ memberId: m, product: "PRD", amount: "30,000.00", term: 12, comakerIds: [c] });
    if (!r.ok) throw new Error(r.error);
    expect(await decide(committeeId(), r.data.id, "APPROVE")).toEqual({ ok: false, error: "The manager reviews it first" });
    expect(await decide(managerId(), r.data.id, "APPROVE")).toEqual({ ok: true, data: { status: "APPROVED" } });
    expect(await decide(managerId(), r.data.id, "APPROVE")).toEqual({ ok: false, error: "The application is already APPROVED" });
    const app = (await getApplication(r.data.id))!;
    expect(app.approvals.map((a) => [a.level, a.decision])).toEqual([["MANAGER", "APPROVE"]]);
  });

  it("above the limit the manager can't finish it; a rejection needs remarks and is final", async () => {
    const m = await goodStandingMember("Borrower");
    const c = await goodStandingMember("Comaker");
    const r = await apply({ memberId: m, product: "PRD", amount: "40,000.00", term: 12, comakerIds: [c] });
    if (!r.ok) throw new Error(r.error);
    expect(await decide(managerId(), r.data.id, "APPROVE")).toEqual({ ok: true, data: { status: "RECOMMENDED" } });
    expect(await decide(managerId(), r.data.id, "APPROVE")).toEqual({ ok: false, error: "The manager already recommended it; the Credit Committee decides now" });
    expect(await decide(committeeId(), r.data.id, "REJECT", "")).toEqual({ ok: false, error: "Enter the reason for rejecting" });
    expect(await decide(committeeId(), r.data.id, "REJECT", "Insufficient capacity to pay")).toEqual({ ok: true, data: { status: "REJECTED" } });
    expect(await decide(committeeId(), r.data.id, "APPROVE")).toMatchObject({ ok: false, error: "The application is already REJECTED" });
  });

  it("the encoder can never decide on their own application (SoD)", async () => {
    const m = await goodStandingMember();
    const r = await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    await expect(withTx((tx) => decideApplication(tx, { applicationId: r.data.id, decision: "APPROVE", remarks: "" }, { id: officerId(), canRecommend: true }))).rejects.toBeInstanceOf(SodError);
  });

  it("approving re-checks eligibility: a member no longer in good standing can't be approved", async () => {
    const id = await member("Lapsed");
    await subscribe(id, 100);
    const paid = await receipt(id, [
      { type: "SHARE_PAYMENT", amount: "2,500.00" },
      { type: "MEMBERSHIP_FEE", amount: "500.00" },
    ]);
    if (!paid.ok) throw new Error(paid.error);
    const r = await apply({ memberId: id, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    expect((await runAs(managerId(), () => cancelReceiptAction({ receiptId: paid.data.id, reason: "Wrong member" }))).ok).toBe(true);
    expect(await decide(managerId(), r.data.id, "APPROVE")).toMatchObject({ ok: false, error: expect.stringMatching(/^Not eligible any more: Member is not in good standing/) });
  });

  it("only the encoding officer cancels, and only before a decision", async () => {
    const m = await goodStandingMember();
    const other = (await makeUser("LOAN_OFFICER", "lo2")).id;
    const r = await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    expect(await runAs(other, () => cancelApplicationAction({ applicationId: r.data.id, reason: "x" }))).toEqual({ ok: false, error: "Only the loan officer who encoded it can cancel it" });
    expect((await runAs(officerId(), () => cancelApplicationAction({ applicationId: r.data.id, reason: "Member withdrew" }))).ok).toBe(true);
    expect(await decide(managerId(), r.data.id, "APPROVE")).toEqual({ ok: false, error: "The application is already CANCELLED" });
  });
});

describe("products and data rules", () => {
  it("the admin changes a product; applications keep the terms they were submitted on", async () => {
    const m = await goodStandingMember();
    const r = await apply({ memberId: m, product: "EMR", amount: "5,000.00", term: 6 });
    if (!r.ok) throw new Error(r.error);
    const emr = (await getLoanProduct(await productId("EMR")))!;
    const admin = (await makeUser("ADMIN", "admin10")).id;
    const change = {
      productId: emr.id,
      name: emr.name,
      ratePct: "2",
      minTerm: 1,
      maxTerm: 6,
      maxAmount: "10,000.00",
      maxMultipleOfPaidUp: "",
      requiredComakers: 0,
      penaltyPct: "2",
      graceDays: 3,
      isActive: true,
      deductions: [{ code: "SERVICE_FEE" as const, name: "Service fee", basis: "PCT_OF_PRINCIPAL" as const, value: "1.5", glKey: "service_fee_income" }],
    };
    await expect(runAs(managerId(), () => updateLoanProductAction(change))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(admin, () => updateLoanProductAction({ ...change, deductions: [{ ...change.deductions[0]!, glKey: "cash_on_hand" }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/can't be credited to cash_on_hand/) });
    expect((await runAs(admin, () => updateLoanProductAction(change))).ok).toBe(true);
    const after = (await getLoanProduct(emr.id))!;
    expect(after.ratePm).toBe("0.02");
    expect(after.deductions.map((d) => [d.code, d.value])).toEqual([["SERVICE_FEE", "0.015"]]);
    expect((await getApplication(r.data.id))!.application.ratePm).toBe("0.015");
  });

  it("applications keep what they were decided on; decisions and comakers can't be changed", async () => {
    const m = await goodStandingMember("Borrower");
    const c = await goodStandingMember("Comaker");
    const r = await apply({ memberId: m, product: "PRD", amount: "10,000.00", term: 12, comakerIds: [c] });
    if (!r.ok) throw new Error(r.error);
    expect((await decide(managerId(), r.data.id, "APPROVE")).ok).toBe(true);
    const pool = getPool();
    await expect(pool.query("UPDATE loan_applications SET amount = 1 WHERE id = $1", [r.data.id])).rejects.toThrow(/only the status can change/);
    await expect(pool.query("DELETE FROM loan_applications WHERE id = $1", [r.data.id])).rejects.toThrow(/can't be deleted/);
    await expect(pool.query("UPDATE loan_approvals SET decision = 'REJECT', remarks = 'x' WHERE application_id = $1", [r.data.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM loan_application_comakers WHERE application_id = $1", [r.data.id])).rejects.toThrow(/immutable/);
  });
});
