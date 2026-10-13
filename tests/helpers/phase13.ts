import { runAs } from "@/lib/auth-guard";
import { approveMemberAction } from "@/modules/members/actions";
import { completeSaleAction, openShiftAction } from "@/modules/store/pos-actions";
import { TEST_PASSWORD } from "./phase01";
import { applicant, createApplicantAs } from "./phase02";
import { product, receive, setupStore, storePeople, supplier } from "./phase12";

export { storePeople };

const fixture = { p1: "", s1: "" };

/**
 * The Phase 13 golden fixture (2026-10-07): product P1 sells at ₱70.00 with an average cost of
 * ₱55.00 and 15 in stock; the store clerk runs the POS; the manager (mgr1) is the supervisor.
 */
export async function setupPos() {
  const people = await setupStore();
  fixture.s1 = await supplier();
  fixture.p1 = await product({ sku: "P1", name: "Sardines 155 g", price: "70.00" });
  await receive(fixture.s1, [[fixture.p1, 15, "55.00"]]);
  return { ...people, ...fixture };
}

export const posFixture = () => fixture;

/** The manager's credential, as typed at the POS by a supervisor. */
export const supervisor = () => ({ username: "mgr1", password: TEST_PASSWORD });

let seq = 0;

/** An ACTIVE member (the first one is M-000001); returns its id and member no. */
export async function member(lastName = "Shopper"): Promise<{ id: string; memberNo: string }> {
  seq += 1;
  const { manager } = storePeople();
  const id = await createApplicantAs(manager, applicant({ lastName, firstName: `Ana ${seq}`, birthdate: `1980-04-${String((seq % 28) + 1).padStart(2, "0")}`, tin: null, validIdNo: `ID-S${seq}` }));
  const r = await runAs(manager, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: "2026-15", privacyConsent: true }));
  if (!r.ok) throw new Error(r.error);
  return { id, memberNo: r.data.memberNo };
}

/** Opens the store clerk's POS shift with an opening fund (pesos). */
export async function openShift(openingFund = "1,000.00", cashier = storePeople().clerk): Promise<string> {
  const r = await runAs(cashier, () => openShiftAction({ openingFund }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** A sale at the store clerk's POS: lines are [productId, qty]. */
export function sell(opts: { lines: Array<[string, number]>; payment?: "CASH" | "CHARGE"; memberId?: string | null; tendered?: string | null }, cashier = storePeople().clerk) {
  return runAs(cashier, () =>
    completeSaleAction({
      memberId: opts.memberId ?? null,
      payment: opts.payment ?? "CASH",
      lines: opts.lines.map(([productId, qty]) => ({ productId, qty })),
      tendered: opts.tendered ?? null,
      birInvoiceNo: null,
    }),
  );
}
