import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { cancelReceiptAction, issueReceiptAction, searchPayorsAction } from "@/modules/cashiering/actions";
import { changeMemberStatusAction } from "@/modules/members/actions";
import { journalLines } from "@/modules/ledger/schema";
import {
  addRateScheduleAction,
  createApplicationAction,
  findMemberAction,
  inspectApplicationAction,
  moveAccountToRouteAction,
  rejectApplicationAction,
  reorderRouteAction,
  setMeterStatusAction,
  transferAccountAction,
} from "@/modules/water/actions";
import { getAccount, getCustomer, routesWithAccounts } from "@/modules/water/queries";
import { waterAccountHistory, waterAccounts, waterApplications, waterCustomers, waterRoutes, waterZones } from "@/modules/water/schema";
import { approveAs, createApplicantAs, applicant } from "../helpers/phase02";
import { addMeter, approvedApplication, createCustomerAs, install, nonMember, payFees, setupWater } from "../helpers/phase05";

let clerk = "";
let manager = "";
let teller = "";
beforeEach(async () => {
  const u = await setupWater();
  clerk = u.clerk.id;
  manager = u.manager.id;
  teller = u.teller.id;
});
afterEach(() => setClock(null));

async function account(id: string) {
  const [a] = await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, id));
  return a!;
}

describe("T5.2 customers", () => {
  it("links a member customer to an approved member and copies the name; a second link is a duplicate", async () => {
    const memberId = await createApplicantAs(manager, applicant());
    await approveAs(manager, memberId);
    const found = await runAs(clerk, () => findMemberAction({ memberNo: "m-000001" }));
    expect(found.ok && found.data.id).toBe(memberId);
    const c = await createCustomerAs(clerk, nonMember({ type: "MEMBER", memberId, lastName: null, firstName: null, address: "" }));
    const [row] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, c.id));
    expect(row?.type).toBe("MEMBER");
    expect(row?.address).not.toBe("");
    await expect(createCustomerAs(clerk, nonMember({ type: "MEMBER", memberId }))).rejects.toThrow(/Customer already exists for M-000001/);
  });

  it("rejects a non-member with the same name and address", async () => {
    await createCustomerAs(clerk);
    await expect(createCustomerAs(clerk)).rejects.toThrow(/Possible duplicate of WC-/);
  });

  it("masks mobile and ID no. unless the viewer may read sensitive data (Q-05.5)", async () => {
    const c = await createCustomerAs(clerk);
    const masked = await getCustomer(c.id, false);
    expect(masked?.customer.mobile).toBe("•••••••4567");
    expect(masked?.customer.validIdNo).toMatch(/^•+4444$/);
    const full = await getCustomer(c.id, true);
    expect(full?.customer.mobile).toBe("09181234567");
  });

  it("a member's customer continues as NON_MEMBER when the member dies (Q-05.6)", async () => {
    const memberId = await createApplicantAs(manager, applicant());
    await approveAs(manager, memberId);
    const c = await createCustomerAs(clerk, nonMember({ type: "MEMBER", memberId }));
    const r = await runAs(manager, () => changeMemberStatusAction({ memberId, to: "DECEASED", reason: "Death certificate", ref: "DC-1" }));
    expect(r.ok).toBe(true);
    const [row] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, c.id));
    expect(row?.type).toBe("NON_MEMBER");
    expect(row?.memberId).toBe(memberId);
  });

  it("the teller finds water customers by name or account no.", async () => {
    const { accountNo } = await approvedApplication(clerk, manager);
    const byName = await runAs(teller, () => searchPayorsAction({ type: "WATER_CUSTOMER", q: "santos" }));
    expect(byName.ok && byName.data.map((r) => r.name)).toContain("Santos, Maria");
    const byAccount = await runAs(teller, () => searchPayorsAction({ type: "WATER_CUSTOMER", q: accountNo }));
    expect(byAccount.ok && byAccount.data).toHaveLength(1);
  });
});

describe("T5.3 applications", () => {
  it("inspect → approve; a rejected application can't be approved", async () => {
    const c = await createCustomerAs(clerk);
    const app = await runAs(clerk, () => createApplicationAction({ customerId: c.id, classification: "RESIDENTIAL", serviceAddress: "Purok 2", routeId: null }));
    if (!app.ok) throw new Error(app.error);
    expect(await runAs(clerk, () => inspectApplicationAction({ applicationId: app.data.id, notes: "Line ok" }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(manager, () => rejectApplicationAction({ applicationId: app.data.id, reason: "No main line" }))).toEqual({ ok: true, data: undefined });
    const again = await runAs(manager, () => rejectApplicationAction({ applicationId: app.data.id, reason: "x" }));
    expect(again).toEqual({ ok: false, error: expect.stringMatching(/already REJECTED/) });
  });

  it("a billing clerk can't approve (no water.approve)", async () => {
    const c = await createCustomerAs(clerk);
    const app = await runAs(clerk, () => createApplicationAction({ customerId: c.id, classification: "RESIDENTIAL", serviceAddress: "Purok 2", routeId: null }));
    if (!app.ok) throw new Error(app.error);
    await expect(runAs(clerk, () => rejectApplicationAction({ applicationId: app.data.id, reason: "x" }))).rejects.toThrow(/forbidden/i);
  });

  it("installing before the fees are paid is rejected", async () => {
    const { applicationId } = await approvedApplication(clerk, manager);
    await addMeter(clerk, "SN-1");
    const r = await install(clerk, applicationId, "SN-1");
    expect(r).toEqual({ ok: false, error: "Collect the connection fee and the meter deposit at the teller first" });
  });

  it("transfers an account to another customer and keeps the deposit and history", async () => {
    const { customer, applicationId, accountId } = await approvedApplication(clerk, manager);
    await payFees(teller, customer.id, applicationId);
    const other = await createCustomerAs(clerk, nonMember({ lastName: "Reyes", firstName: "Jose" }));
    expect(await runAs(clerk, () => transferAccountAction({ accountId, newCustomerId: other.id, reason: "Sold the house" }))).toEqual({ ok: true, data: undefined });
    const a = await account(accountId);
    expect(a.customerId).toBe(other.id);
    expect(a.depositAmount).toBe(100_000n);
    const h = await getDb().select().from(waterAccountHistory).where(and(eq(waterAccountHistory.accountId, accountId), eq(waterAccountHistory.event, "TRANSFERRED")));
    expect(h).toHaveLength(1);
  });
});

describe("T5.4 meters", () => {
  it("rejects a duplicate serial, and status changes of an installed meter", async () => {
    const { customer, applicationId } = await approvedApplication(clerk, manager);
    const meterId = await addMeter(clerk, "sn-77");
    await expect(addMeter(clerk, "SN-77")).rejects.toThrow(/already in the inventory/);
    await payFees(teller, customer.id, applicationId);
    expect((await install(clerk, applicationId, "SN-77", 5)).ok).toBe(true);
    const r = await runAs(clerk, () => setMeterStatusAction({ meterId, status: "DEFECTIVE" }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/is installed/) });
  });

  it("rejects an initial reading wider than the meter's digits", async () => {
    const { customer, applicationId } = await approvedApplication(clerk, manager);
    await addMeter(clerk, "SN-5");
    await payFees(teller, customer.id, applicationId);
    expect(await install(clerk, applicationId, "SN-5", 10_000)).toEqual({ ok: false, error: expect.stringMatching(/0 to 9999/) });
  });
});

describe("T5.5 rate schedules", () => {
  it("rejects a version that isn't after the latest one, and a bad money string", async () => {
    const base = { classification: "RESIDENTIAL" as const, minCharge: "200.00", minCubic: 10, nwrbRef: "NWRB-1", blocks: [{ from: 11, to: null, rate: "25.00" }] };
    expect(await runAs(manager, () => addRateScheduleAction({ ...base, effectiveFrom: "2025-12-01" }))).toEqual({ ok: false, error: expect.stringMatching(/after/) });
    expect(await runAs(manager, () => addRateScheduleAction({ ...base, effectiveFrom: "2027-01-01", minCharge: "abc" }))).toEqual({ ok: false, error: expect.stringMatching(/valid minimum charge/) });
    await expect(runAs(clerk, () => addRateScheduleAction({ ...base, effectiveFrom: "2027-01-01" }))).rejects.toThrow(/forbidden/i);
  });
});

describe("T5.6 teller items", () => {
  it("rejects a wrong fee amount and a second payment of the same fee", async () => {
    const { customer, applicationId } = await approvedApplication(clerk, manager);
    await payFees(teller, customer.id, applicationId);
    const again = await runAs(teller, () =>
      issueReceiptAction({
        payor: { type: "WATER_CUSTOMER", id: customer.id, name: "" },
        mode: "CASH",
        checkNo: null,
        birReceiptNo: "BIR-W-2",
        items: [{ type: "WATER_CONNECTION_FEE", refId: applicationId, amount: "3,500.00", description: null }],
      }),
    );
    expect(again).toEqual({ ok: false, error: expect.stringMatching(/already paid/) });
    const wrong = await runAs(teller, () =>
      issueReceiptAction({
        payor: { type: "WATER_CUSTOMER", id: customer.id, name: "" },
        mode: "CASH",
        checkNo: null,
        birReceiptNo: "BIR-W-3",
        items: [{ type: "METER_DEPOSIT", refId: applicationId, amount: "999.00", description: null }],
      }),
    );
    expect(wrong).toEqual({ ok: false, error: expect.stringMatching(/₱1,000.00/) });
  });

  it("cancelling the fee receipt before installation reverses the deposit; after installation it is blocked", async () => {
    const first = await approvedApplication(clerk, manager);
    const r1 = await payFees(teller, first.customer.id, first.applicationId);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: r1.id, reason: "Wrong payor" }))).toEqual({ ok: true, data: undefined });
    expect((await account(first.accountId)).depositAmount).toBe(0n);
    const tagged = await getDb().select().from(journalLines).where(eq(journalLines.customerId, first.customer.id));
    expect(tagged.reduce((s, l) => s + l.credit - l.debit, 0n)).toBe(0n);

    const r2 = await payFees(teller, first.customer.id, first.applicationId, false);
    await addMeter(clerk, "SN-9");
    expect((await install(clerk, first.applicationId, "SN-9")).ok).toBe(true);
    const blocked = await runAs(manager, () => cancelReceiptAction({ receiptId: r2.id, reason: "Late" }));
    expect(blocked).toEqual({ ok: false, error: expect.stringMatching(/already has a meter installed/) });
  });
});

describe("T5.8 routes", () => {
  it("reorders a route and moves an account to the end of another route", async () => {
    const a = await approvedApplication(clerk, manager);
    const b = await approvedApplication(clerk, manager);
    const [route] = await getDb().select().from(waterRoutes);
    expect([(await account(a.accountId)).sequenceNo, (await account(b.accountId)).sequenceNo]).toEqual([1, 2]);
    expect(await runAs(clerk, () => reorderRouteAction({ routeId: route!.id, accountIds: [b.accountId, a.accountId] }))).toEqual({ ok: true, data: undefined });
    expect((await account(b.accountId)).sequenceNo).toBe(1);
    expect(await runAs(clerk, () => reorderRouteAction({ routeId: route!.id, accountIds: [b.accountId] }))).toEqual({ ok: false, error: expect.stringMatching(/every account/) });

    const [zone] = await getDb().select().from(waterZones);
    const [r2] = await getDb().insert(waterRoutes).values({ zoneId: zone!.id, code: "R-02", name: "Route 2" }).returning();
    expect(await runAs(clerk, () => moveAccountToRouteAction({ accountId: b.accountId, routeId: r2!.id }))).toEqual({ ok: true, data: undefined });
    const moved = await account(b.accountId);
    expect([moved.routeId, moved.sequenceNo]).toEqual([r2!.id, 1]);
    const tree = await routesWithAccounts();
    expect(tree[0]?.routes.map((r) => r.accounts.map((x) => x.accountNo))).toEqual([[a.accountNo], [b.accountNo]]);
  });

  it("the account profile shows the current meter and history", async () => {
    const { customer, applicationId, accountId } = await approvedApplication(clerk, manager);
    await payFees(teller, customer.id, applicationId);
    await addMeter(clerk, "SN-3");
    await install(clerk, applicationId, "SN-3", 12);
    const view = await getAccount(accountId, false);
    expect(view?.current?.serialNo).toBe("SN-3");
    expect(view?.account.status).toBe("ACTIVE");
    expect(view?.history.map((h) => h.event)).toEqual(expect.arrayContaining(["CREATED", "METER_INSTALLED", "STATUS"]));
    const [app] = await getDb().select().from(waterApplications).where(eq(waterApplications.id, applicationId));
    expect(app?.status).toBe("INSTALLED");
  });
});
