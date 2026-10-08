import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import {
  approveMemberAction,
  changeMemberStatusAction,
  createApplicantAction,
  getMemberAction,
  searchMembersAction,
  setBeneficiariesAction,
} from "@/modules/members/actions";
import { memberStatusHistory } from "@/modules/members/schema";
import { makeUser, seedReference } from "../helpers/phase01";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";

// Golden values from docs/phases/PHASE-02-members.md › Acceptance tests.

/** 2026-10-07 09:00 in Manila. */
const BUSINESS_DAY = new Date("2026-10-07T01:00:00Z");

let managerId = "";

beforeEach(async () => {
  await seedReference();
  managerId = (await makeUser("MANAGER", "manager1")).id;
  setClock(() => BUSINESS_DAY);
});
afterEach(() => setClock(null));

describe("Phase 02 acceptance", () => {
  it('A2.1 create applicant "Juan Dela Cruz", born 1990-05-10 → APPLICANT, member_no null', async () => {
    const id = await createApplicantAs(managerId, applicant());
    const view = await runAs(managerId, () => getMemberAction({ memberId: id }));
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.data.member.status).toBe("APPLICANT");
    expect(view.data.member.memberNo).toBeNull();
    expect(view.data.member.lastName).toBe("Dela Cruz");
    expect(view.data.member.birthdate).toBe("1990-05-10");
  });

  it('A2.2 approve without pmes_date → "PMES date is required"', async () => {
    const id = await createApplicantAs(managerId, applicant());
    const r = await runAs(managerId, () =>
      approveMemberAction({ memberId: id, pmesDate: null, bodResolutionNo: "2026-15", privacyConsent: true }),
    );
    expect(r).toEqual({ ok: false, error: "PMES date is required" });
  });

  it("A2.3 approve with PMES 2026-10-01, BOD Res. 2026-15, consent, business date 2026-10-07 → ACTIVE, M-000001, membership_date 2026-10-07", async () => {
    const id = await createApplicantAs(managerId, applicant({ privacyConsent: false }));
    const r = await runAs(managerId, () =>
      approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: "2026-15", privacyConsent: true }),
    );
    expect(r).toEqual({ ok: true, data: { memberNo: "M-000001" } });

    const view = await runAs(managerId, () => getMemberAction({ memberId: id }));
    if (!view.ok) throw new Error(view.error);
    expect(view.data.member).toMatchObject({
      status: "ACTIVE",
      memberNo: "M-000001",
      membershipDate: "2026-10-07",
      pmesDate: "2026-10-01",
      bodResolutionNo: "2026-15",
    });
    expect(view.data.member.privacyConsentAt).not.toBeNull();
  });

  it("A2.4 approve a second applicant → M-000002", async () => {
    const first = await createApplicantAs(managerId, applicant());
    expect(await approveAs(managerId, first)).toBe("M-000001");
    const second = await createApplicantAs(managerId, applicant({ lastName: "Santos", firstName: "Maria", sex: "FEMALE" }));
    expect(await approveAs(managerId, second)).toBe("M-000002");
  });

  it('A2.5 create applicant "JUAN  dela cruz" born 1990-05-10 → blocked: "Possible duplicate of M-000001"', async () => {
    const first = await createApplicantAs(managerId, applicant());
    await approveAs(managerId, first);

    const r = await runAs(managerId, () =>
      createApplicantAction(applicant({ firstName: "JUAN ", lastName: "dela  cruz", birthdate: "1990-05-10" })),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Possible duplicate of M-000001");
  });

  it('A2.6 beneficiaries 60% + 30% → rejected "must total 100%"; 60% + 40% → accepted', async () => {
    const id = await createApplicantAs(managerId, applicant());
    const bad = await runAs(managerId, () =>
      setBeneficiariesAction({
        memberId: id,
        beneficiaries: [
          { name: "Ana Dela Cruz", relationship: "Spouse", birthdate: null, sharePct: "60" },
          { name: "Ben Dela Cruz", relationship: "Child", birthdate: null, sharePct: "30" },
        ],
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/must total 100%/);

    const good = await runAs(managerId, () =>
      setBeneficiariesAction({
        memberId: id,
        beneficiaries: [
          { name: "Ana Dela Cruz", relationship: "Spouse", birthdate: null, sharePct: "60" },
          { name: "Ben Dela Cruz", relationship: "Child", birthdate: null, sharePct: "40" },
        ],
      }),
    );
    expect(good.ok).toBe(true);
    const view = await runAs(managerId, () => getMemberAction({ memberId: id }));
    if (!view.ok) throw new Error(view.error);
    expect(view.data.beneficiaries.map((b) => b.sharePct)).toEqual(["60.00", "40.00"]);
  });

  it('A2.7 search "dela cruz" → finds M-000001', async () => {
    const id = await createApplicantAs(managerId, applicant());
    await approveAs(managerId, id);
    await createApplicantAs(managerId, applicant({ lastName: "Santos", firstName: "Maria", sex: "FEMALE" }));

    const r = await runAs(managerId, () => searchMembersAction({ q: "dela cruz" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.rows.map((m) => m.memberNo)).toEqual(["M-000001"]);
  });

  it("A2.8 TELLER (no read_sensitive) views M-000001 → birthdate ••••-••-••; valid_id_no masked except last 4", async () => {
    const id = await createApplicantAs(managerId, applicant({ validIdNo: "1234-5678-9012-3456" }));
    await approveAs(managerId, id);
    const teller = await makeUser("TELLER", "teller1");

    const view = await runAs(teller.id, () => getMemberAction({ memberId: id }));
    if (!view.ok) throw new Error(view.error);
    expect(view.data.member.memberNo).toBe("M-000001");
    expect(view.data.member.birthdate).toBe("••••-••-••");
    expect(view.data.member.validIdNo).toBe("•".repeat("1234-5678-9012-3456".length - 4) + "3456");
    expect(view.data.member.tin).not.toContain("123-456");
    expect(view.data.member.mobile).not.toContain("0917123");

    // A user with members.read_sensitive sees the real values.
    const full = await runAs(managerId, () => getMemberAction({ memberId: id }));
    if (!full.ok) throw new Error(full.error);
    expect(full.data.member.birthdate).toBe("1990-05-10");
    expect(full.data.member.validIdNo).toBe("1234-5678-9012-3456");
  });

  it("A2.9 status ACTIVE → TERMINATED → ACTIVE: second change rejected (terminal); history has 1 row", async () => {
    const id = await createApplicantAs(managerId, applicant());
    await approveAs(managerId, id);
    const historyAfterApproval = await getDb().select().from(memberStatusHistory).where(eq(memberStatusHistory.memberId, id));

    const first = await runAs(managerId, () =>
      changeMemberStatusAction({ memberId: id, to: "TERMINATED", reason: "Voluntary withdrawal", ref: "BOD Res. 2026-20" }),
    );
    expect(first.ok).toBe(true);
    const second = await runAs(managerId, () =>
      changeMemberStatusAction({ memberId: id, to: "ACTIVE", reason: "Re-activate", ref: null }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/terminal/i);

    // The scenario adds exactly one history row (the termination); approval's own row is separate.
    const history = await getDb().select().from(memberStatusHistory).where(eq(memberStatusHistory.memberId, id));
    const added = history.filter((h) => !historyAfterApproval.some((a) => a.id === h.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ fromStatus: "ACTIVE", toStatus: "TERMINATED", reason: "Voluntary withdrawal" });
  });
});
