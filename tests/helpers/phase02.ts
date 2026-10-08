import { runAs } from "@/lib/auth-guard";
import { approveMemberAction, createApplicantAction } from "@/modules/members/actions";
import type { MemberInput } from "@/modules/members/validation";

/** A complete applicant record; override any field. */
export function applicant(overrides: Partial<MemberInput> = {}): MemberInput {
  return {
    type: "REGULAR",
    lastName: "Dela Cruz",
    firstName: "Juan",
    middleName: null,
    suffix: null,
    birthdate: "1990-05-10",
    sex: "MALE",
    civilStatus: "MARRIED",
    addrStreet: null,
    addrPurok: "Purok 3",
    addrBarangay: "Pipindan",
    addrMunicipality: "Binangonan",
    addrProvince: "Rizal",
    mobile: "09171234567",
    email: null,
    occupation: "Farmer",
    employer: null,
    tin: "123-456-789-000",
    validIdType: "PhilSys ID",
    validIdNo: "1234-5678-9012-3456",
    pmesDate: null,
    bodResolutionNo: null,
    privacyConsent: true,
    remarks: null,
    ...overrides,
  };
}

/** Creates an applicant as `actorId` and returns its id (throws if the action fails). */
export async function createApplicantAs(actorId: string, input: MemberInput): Promise<string> {
  const r = await runAs(actorId, () => createApplicantAction(input));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** Approves with complete PMES / BOD / consent data and returns the member no. */
export async function approveAs(actorId: string, memberId: string): Promise<string> {
  const r = await runAs(actorId, () =>
    approveMemberAction({ memberId, pmesDate: "2026-10-01", bodResolutionNo: "2026-15", privacyConsent: true }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data.memberNo;
}
