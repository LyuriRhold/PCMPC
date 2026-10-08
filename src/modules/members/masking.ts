/**
 * Server-side masking of sensitive member data for users without `members.read_sensitive`
 * (Data Privacy Act). Masked values never leave the server.
 */
export const MASKED_DATE = "••••-••-••";

/** Every character except the last `keep` becomes "•": "1234-5678" → "•••••5678". */
export function maskTail(value: string | null, keep = 4): string | null {
  if (value === null) return null;
  if (value.length <= keep) return "•".repeat(value.length);
  return "•".repeat(value.length - keep) + value.slice(-keep);
}

export type SensitiveFields = {
  birthdate: string;
  validIdNo: string | null;
  tin: string | null;
  mobile: string | null;
};

export function maskSensitive<T extends SensitiveFields>(m: T): T {
  return { ...m, birthdate: MASKED_DATE, validIdNo: maskTail(m.validIdNo), tin: maskTail(m.tin), mobile: maskTail(m.mobile) };
}
