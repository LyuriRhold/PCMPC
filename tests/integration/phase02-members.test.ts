import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { auditLog } from "@/modules/audit/schema";
import {
  approveMemberAction,
  changeMemberStatusAction,
  createApplicantAction,
  searchMembersAction,
  setBeneficiariesAction,
  updateMemberAction,
} from "@/modules/members/actions";
import { members } from "@/modules/members/schema";
import { registerTerminationRule, unregisterTerminationRule } from "@/modules/members/termination";
import { makeUser, seedReference } from "../helpers/phase01";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";

let mgr = "";
beforeEach(async () => {
  await seedReference();
  mgr = (await makeUser("MANAGER", "manager1")).id;
  setClock(() => new Date("2026-10-07T01:00:00Z"));
});
afterEach(() => setClock(null));

const statusOf = async (id: string) => (await getDb().select().from(members).where(eq(members.id, id)))[0]?.status;

describe("T2.2 member service", () => {
  it("approval needs a BOD resolution and consent; only applicants can be approved", async () => {
    const id = await createApplicantAs(mgr, applicant({ privacyConsent: false }));
    expect(
      await runAs(mgr, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: null, privacyConsent: true })),
    ).toEqual({ ok: false, error: "BOD resolution no. is required" });
    expect(
      await runAs(mgr, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: "2026-15", privacyConsent: false })),
    ).toEqual({ ok: false, error: "Privacy consent is required" });
    expect(
      await runAs(mgr, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-08", bodResolutionNo: "2026-15", privacyConsent: true })),
    ).toEqual({ ok: false, error: "PMES date can't be in the future" });
    await approveAs(mgr, id);
    expect(await runAs(mgr, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: "2026-15", privacyConsent: true }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Only applicants/),
    });
  });

  it("follows the DOMAIN §4 lifecycle: ACTIVE ↔ INACTIVE, applicants can't change status, DECEASED is terminal", async () => {
    const id = await createApplicantAs(mgr, applicant());
    expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "ACTIVE", reason: "x", ref: null }))).toMatchObject({ ok: false });
    await approveAs(mgr, id);
    expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "INACTIVE", reason: "No activity", ref: null }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "ACTIVE", reason: "Back", ref: null }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "DECEASED", reason: "Death certificate", ref: "DC-1" }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "INACTIVE", reason: "x", ref: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/terminal/) });
    expect(await statusOf(id)).toBe("DECEASED");
    const rows = await getDb().select().from(auditLog).where(eq(auditLog.action, "member.status_change"));
    expect(rows).toHaveLength(3);
  });

  it("canTerminate rules registered by other modules block termination", async () => {
    const id = await createApplicantAs(mgr, applicant());
    await approveAs(mgr, id);
    registerTerminationRule({ name: "test-loan", check: async (memberId) => (memberId === id ? "has an active loan" : null) });
    try {
      expect(await runAs(mgr, () => changeMemberStatusAction({ memberId: id, to: "TERMINATED", reason: "Withdrawal", ref: null }))).toEqual({
        ok: false,
        error: "Can't terminate: has an active loan",
      });
      expect(await statusOf(id)).toBe("ACTIVE");
    } finally {
      unregisterTerminationRule("test-loan");
    }
  });

  it("duplicates ignore terminated members and the member being edited", async () => {
    const a = await createApplicantAs(mgr, applicant());
    await approveAs(mgr, a);
    // Editing the same member keeps its own name: not a duplicate of itself.
    expect(await runAs(mgr, () => updateMemberAction({ memberId: a, data: applicant({ occupation: "Fisherman" }) }))).toEqual({ ok: true, data: undefined });
    // A second applicant with the same name/birthdate is blocked, even before approval.
    const dupApplicant = await runAs(mgr, () => createApplicantAction(applicant({ lastName: "DELA CRUZ" })));
    expect(dupApplicant).toMatchObject({ ok: false, error: expect.stringContaining("M-000001") });
    // After termination, the same person can apply again.
    await runAs(mgr, () => changeMemberStatusAction({ memberId: a, to: "TERMINATED", reason: "Withdrawal", ref: null }));
    expect(await runAs(mgr, () => createApplicantAction(applicant()))).toMatchObject({ ok: true });
    // Two applicants (no member no.) name the existing applicant in the message.
    expect(await runAs(mgr, () => createApplicantAction(applicant()))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/applicant Dela Cruz, Juan/),
    });
  });

  it("search ignores accents and extra spaces and filters by status", async () => {
    const id = await createApplicantAs(mgr, applicant({ lastName: "Peñaranda", firstName: "José" }));
    await approveAs(mgr, id);
    await createApplicantAs(mgr, applicant({ lastName: "Santos", firstName: "Maria", sex: "FEMALE" }));
    const hit = await runAs(mgr, () => searchMembersAction({ q: "  penaranda   jose " }));
    expect(hit.ok && hit.data.rows.map((r) => r.memberNo)).toEqual(["M-000001"]);
    const byNo = await runAs(mgr, () => searchMembersAction({ q: "m-000001" }));
    expect(byNo.ok && byNo.data.total).toBe(1);
    const applicants = await runAs(mgr, () => searchMembersAction({ status: "APPLICANT" }));
    expect(applicants.ok && applicants.data.rows.map((r) => r.lastName)).toEqual(["Santos"]);
  });
});

describe("T2.3 beneficiaries", () => {
  it("accepts 33.33 + 33.33 + 33.34, rejects zero shares, and an empty list clears them", async () => {
    const id = await createApplicantAs(mgr, applicant());
    const set = (pcts: string[]) =>
      runAs(mgr, () =>
        setBeneficiariesAction({
          memberId: id,
          beneficiaries: pcts.map((p, i) => ({ name: `Child ${i + 1}`, relationship: "Child", birthdate: null, sharePct: p })),
        }),
      );
    expect(await set(["33.33", "33.33", "33.34"])).toEqual({ ok: true, data: undefined });
    expect(await set(["100", "0"])).toMatchObject({ ok: false, error: expect.stringMatching(/more than 0%/) });
    expect(await set(["50.5", "49.49"])).toMatchObject({ ok: false, error: "Beneficiary shares must total 100% (now 99.99%)" });
    expect(await set([])).toEqual({ ok: true, data: undefined });
  });
});

describe("T2.4 permissions", () => {
  it("a TELLER can search and view but not encode, approve or change status", async () => {
    const teller = await makeUser("TELLER", "teller1");
    const id = await createApplicantAs(mgr, applicant());
    await expect(runAs(teller.id, () => createApplicantAction(applicant({ firstName: "Pedro" })))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      runAs(teller.id, () => approveMemberAction({ memberId: id, pmesDate: "2026-10-01", bodResolutionNo: "1", privacyConsent: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(teller.id, () => changeMemberStatusAction({ memberId: id, to: "INACTIVE", reason: "x", ref: null }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await runAs(teller.id, () => searchMembersAction({}))).ok).toBe(true);
  });
});
