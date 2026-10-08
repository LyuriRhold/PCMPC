import type { BeneficiaryData } from "../../src/modules/members/service";
import type { MemberInput } from "../../src/modules/members/validation";

/**
 * DEV ONLY: six sample members for local development and demos (never part of `db:seed`).
 * `approve` members go through Board approval and get member numbers; the rest stay APPLICANT.
 */
export type DevMember = { input: MemberInput; approve: boolean; beneficiaries?: BeneficiaryData[] };

const base = {
  middleName: null,
  suffix: null,
  addrStreet: null,
  addrBarangay: "Pipindan",
  addrMunicipality: "Binangonan",
  addrProvince: "Rizal",
  email: null,
  employer: null,
  tin: null,
  pmesDate: null,
  bodResolutionNo: null,
  privacyConsent: true,
  remarks: "DEV SAMPLE (scripts/fixtures/dev-members.ts)",
} as const;

export const DEV_MEMBERS: DevMember[] = [
  {
    approve: true,
    input: { ...base, type: "REGULAR", lastName: "Dela Cruz", firstName: "Juan", middleName: "Santos", birthdate: "1980-05-10", sex: "MALE", civilStatus: "MARRIED", addrPurok: "Purok 1", mobile: "09170000001", occupation: "Farmer", validIdType: "PhilSys ID", validIdNo: "0000-1111-2222-3331" },
    beneficiaries: [
      { name: "Maria Dela Cruz", relationship: "Spouse", birthdate: "1982-08-21", sharePct: "60" },
      { name: "Jose Dela Cruz", relationship: "Child", birthdate: "2008-01-15", sharePct: "40" },
    ],
  },
  {
    approve: true,
    input: { ...base, type: "REGULAR", lastName: "Reyes", firstName: "Ana", birthdate: "1975-11-02", sex: "FEMALE", civilStatus: "WIDOWED", addrPurok: "Purok 2", mobile: "09170000002", occupation: "Sari-sari store owner", validIdType: "Senior Citizen ID", validIdNo: "SC-000002" },
    beneficiaries: [{ name: "Liza Reyes", relationship: "Child", birthdate: "1999-04-30", sharePct: "100" }],
  },
  {
    approve: true,
    input: { ...base, type: "REGULAR", lastName: "Santos", firstName: "Pedro", birthdate: "1968-03-19", sex: "MALE", civilStatus: "MARRIED", addrPurok: "Purok 3", mobile: "09170000003", occupation: "Fisherman", validIdType: "Voter's ID", validIdNo: "VID-000003" },
  },
  {
    approve: true,
    input: { ...base, type: "ASSOCIATE", lastName: "Garcia", firstName: "Rosa", birthdate: "1992-07-07", sex: "FEMALE", civilStatus: "SINGLE", addrPurok: "Sitio Ibaba", mobile: "09170000004", occupation: "Teacher", employer: "Pipindan Elementary School", validIdType: "PRC ID", validIdNo: "PRC-000004" },
  },
  {
    approve: false,
    input: { ...base, type: "REGULAR", lastName: "Mendoza", firstName: "Carlo", birthdate: "1995-12-12", sex: "MALE", civilStatus: "SINGLE", addrPurok: "Purok 1", mobile: "09170000005", occupation: "Tricycle driver", validIdType: "Driver's License", validIdNo: "N00-00-000005" },
  },
  {
    approve: false,
    input: { ...base, type: "REGULAR", lastName: "Peñaranda", firstName: "Lourdes", birthdate: "1988-09-23", sex: "FEMALE", civilStatus: "MARRIED", addrPurok: "Purok 4", mobile: "09170000006", occupation: "Seamstress", validIdType: "UMID", validIdNo: "0000-0000006-6", privacyConsent: false },
  },
];
