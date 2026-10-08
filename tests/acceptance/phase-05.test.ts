import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import {
  activateAccountAction,
  addRateScheduleAction,
  addSeniorEligibilityAction,
  approveApplicationAction,
  createApplicationAction,
  createCustomerAction,
  replaceMeterAction,
} from "@/modules/water/actions";
import { computeWaterCharge } from "@/modules/water/rates";
import { isSeniorEligible } from "@/modules/water/service";
import { waterAccounts, waterApplications, waterMeterInstallations, waterMeters } from "@/modules/water/schema";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";
import { acct, P } from "../helpers/phase03";
import {
  addMeter,
  approvedApplication,
  createCustomerAs,
  install,
  nonMember,
  payFees,
  setupWater,
} from "../helpers/phase05";

// Golden values from docs/phases/PHASE-05-water-connections.md › Acceptance tests (sample tariff, CONFIRM).

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

async function account(accountId: string) {
  const [a] = await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, accountId));
  return a;
}

describe("Phase 05 acceptance", () => {
  it('A5.1 create NON_MEMBER customer "Maria Santos" → WC-000001, NON_MEMBER, member_id null', async () => {
    const c = await createCustomerAs(clerk);
    expect(c.customerNo).toBe("WC-000001");
    const { waterCustomers } = await import("@/modules/water/schema");
    const [row] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, c.id));
    expect(row).toMatchObject({ type: "NON_MEMBER", memberId: null, lastName: "Santos", firstName: "Maria" });
  });

  it('A5.2 MEMBER customer from M-000001 → OK (name/address copied); again → "Customer already exists for M-000001"', async () => {
    const memberId = await createApplicantAs(manager, applicant());
    expect(await approveAs(manager, memberId)).toBe("M-000001");

    const input = nonMember({ type: "MEMBER", memberId, lastName: "", firstName: "", address: "" });
    const first = await runAs(clerk, () => createCustomerAction(input));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const { waterCustomers } = await import("@/modules/water/schema");
    const [row] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, first.data.id));
    expect(row).toMatchObject({ type: "MEMBER", memberId, lastName: "Dela Cruz", firstName: "Juan" });
    expect(row?.address).toContain("Pipindan");

    expect(await runAs(clerk, () => createCustomerAction(input))).toEqual({ ok: false, error: "Customer already exists for M-000001" });
  });

  it("A5.3 application encoded by clerk1, approved by clerk1 → Forbidden (SoD); approved by mgr1 → APPROVED", async () => {
    const c = await createCustomerAs(clerk);
    const app = await runAs(clerk, () => createApplicationAction({ customerId: c.id, classification: "RESIDENTIAL", serviceAddress: "Purok 2", routeId: null }));
    if (!app.ok) throw new Error(app.error);
    await expect(runAs(clerk, () => approveApplicationAction({ applicationId: app.data.id }))).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await runAs(manager, () => approveApplicationAction({ applicationId: app.data.id }));
    expect(ok.ok).toBe(true);
    const [row] = await getDb().select().from(waterApplications).where(eq(waterApplications.id, app.data.id));
    expect(row).toMatchObject({ status: "APPROVED", approvedBy: manager, encodedBy: clerk });
  });

  it("A5.4 activate without a meter → rejected; install SN-1001 with initial reading 0 → account ACTIVE", async () => {
    const a = await approvedApplication(clerk, manager);
    expect((await account(a.accountId))?.status).toBe("PENDING");
    const activate = await runAs(clerk, () => activateAccountAction({ accountId: a.accountId }));
    expect(activate.ok).toBe(false);

    await payFees(teller, a.customer.id, a.applicationId);
    await addMeter(clerk, "SN-1001");
    const r = await install(clerk, a.applicationId, "SN-1001", 0);
    expect(r).toMatchObject({ ok: true });
    expect((await account(a.accountId))?.status).toBe("ACTIVE");
  });

  it("A5.5 install SN-1001 on a second account while still installed → rejected", async () => {
    const a = await approvedApplication(clerk, manager);
    await payFees(teller, a.customer.id, a.applicationId);
    await addMeter(clerk, "SN-1001");
    expect((await install(clerk, a.applicationId, "SN-1001")).ok).toBe(true);

    const b = await approvedApplication(clerk, manager);
    await payFees(teller, b.customer.id, b.applicationId, false);
    const second = await install(clerk, b.applicationId, "SN-1001");
    expect(second.ok).toBe(false);
    expect((await account(b.accountId))?.status).toBe("PENDING");
  });

  it("A5.6 RESIDENTIAL charge for 0, 7, 10, 18, 35 m³ → ₱200.00, ₱200.00, ₱200.00, ₱400.00, ₱925.00", async () => {
    const totals = [];
    for (const m3 of [0, 7, 10, 18, 35]) totals.push((await computeWaterCharge("RESIDENTIAL", m3, "2026-10-31")).total);
    expect(totals).toEqual([P(200), P(200), P(200), P(400), P(925)]);
  });

  it("A5.7 COMMERCIAL 15 m³ → ₱600.00", async () => {
    expect((await computeWaterCharge("COMMERCIAL", 15, "2026-10-31")).total).toBe(P(600));
  });

  it("A5.8 new RESIDENTIAL version from 2027-01-01 with 11–20 m³ at ₱28.00; 18 m³ for 2026-12-31 vs 2027-01-31 → ₱400.00 vs ₱424.00", async () => {
    const r = await runAs(manager, () =>
      addRateScheduleAction({
        classification: "RESIDENTIAL",
        effectiveFrom: "2027-01-01",
        minCharge: "200.00",
        minCubic: 10,
        blocks: [
          { from: 11, to: 20, rate: "28.00" },
          { from: 21, to: 30, rate: "30.00" },
          { from: 31, to: null, rate: "35.00" },
        ],
        nwrbRef: "NWRB sample 2027 (CONFIRM)",
      }),
    );
    expect(r.ok).toBe(true);
    expect((await computeWaterCharge("RESIDENTIAL", 18, "2026-12-31")).total).toBe(P(400));
    expect((await computeWaterCharge("RESIDENTIAL", 18, "2027-01-31")).total).toBe(P(424));
  });

  it("A5.9 one receipt: connection fee ₱3,500.00 + meter deposit ₱1,000.00 for WC-000001 → one CRJ: Dr Cash 4,500 / Cr Connection Fee Income 3,500 / Cr Customers' Deposits 1,000 (tagged)", async () => {
    const a = await approvedApplication(clerk, manager);
    expect(a.customer.customerNo).toBe("WC-000001");
    const receipt = await payFees(teller, a.customer.id, a.applicationId);
    expect(receipt.total).toBe("450000");

    const entries = await getDb().select().from(journalEntries).where(and(eq(journalEntries.sourceId, receipt.id), eq(journalEntries.book, "CRJ")));
    expect(entries).toHaveLength(1);
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, entries[0]!.id));
    const [cash, fee, deposits] = await Promise.all([acct("cash_on_hand"), acct("water_connection_fee_income"), acct("customers_deposits")]);
    const view = lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, customerId: l.customerId }));
    expect(view).toHaveLength(3);
    expect(view).toContainEqual({ accountId: cash, debit: P(4500), credit: 0n, customerId: null });
    expect(view).toContainEqual({ accountId: fee, debit: 0n, credit: P(3500), customerId: null });
    expect(view).toContainEqual({ accountId: deposits, debit: 0n, credit: P(1000), customerId: a.customer.id });
  });

  it("A5.10 replace the meter: old final 1,250, new SN-2002 initial 0 → both installations recorded, account ACTIVE, SN-1001 DEFECTIVE", async () => {
    const a = await approvedApplication(clerk, manager);
    await payFees(teller, a.customer.id, a.applicationId);
    await addMeter(clerk, "SN-1001");
    await install(clerk, a.applicationId, "SN-1001", 0);
    await addMeter(clerk, "SN-2002");

    const r = await runAs(clerk, () =>
      replaceMeterAction({ accountId: a.accountId, oldFinalReading: 1250, oldMeterStatus: "DEFECTIVE", newMeterSerial: "SN-2002", newInitialReading: 0, reason: "Stuck meter" }),
    );
    expect(r).toEqual({ ok: true, data: undefined });

    const installs = await getDb().select().from(waterMeterInstallations).where(eq(waterMeterInstallations.accountId, a.accountId));
    expect(installs).toHaveLength(2);
    const old = installs.find((i) => i.removedAt !== null);
    const current = installs.find((i) => i.removedAt === null);
    expect(old).toMatchObject({ initialReading: 0, finalReading: 1250 });
    expect(current).toMatchObject({ initialReading: 0, finalReading: null });
    expect((await account(a.accountId))?.status).toBe("ACTIVE");
    const [sn1001] = await getDb().select().from(waterMeters).where(eq(waterMeters.serialNo, "SN-1001"));
    expect(sn1001?.status).toBe("DEFECTIVE");
  });

  it("A5.11 senior eligibility on a COMMERCIAL account → rejected; residential with valid_until in the past → not eligible on the billing date", async () => {
    const commercial = await approvedApplication(clerk, manager, "COMMERCIAL");
    expect(
      await runAs(clerk, () =>
        addSeniorEligibilityAction({ accountId: commercial.accountId, seniorName: "Lola Santos", oscaIdNo: "OSCA-1", validFrom: "2026-01-01", validUntil: "2026-12-31" }),
      ),
    ).toMatchObject({ ok: false });

    const residential = await approvedApplication(clerk, manager);
    const added = await runAs(clerk, () =>
      addSeniorEligibilityAction({ accountId: residential.accountId, seniorName: "Lolo Santos", oscaIdNo: "OSCA-2", validFrom: "2025-01-01", validUntil: "2025-12-31" }),
    );
    expect(added.ok).toBe(true);
    expect(await isSeniorEligible(residential.accountId, "2026-10-31")).toBe(false);
    expect(await isSeniorEligible(residential.accountId, "2025-06-30")).toBe(true);
  });
});
