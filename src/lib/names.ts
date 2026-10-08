/**
 * Name normalization for duplicate checks and search: lowercase, accents removed
 * ("Peñaranda" → "penaranda"), punctuation treated as a space, and runs of spaces collapsed.
 * `normalizeName("  JUAN  dela-Cruz ")` → `"juan dela cruz"`.
 */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Key for the duplicate rule: normalized last name + first name. */
export function nameKey(lastName: string, firstName: string): string {
  return `${normalizeName(lastName)}|${normalizeName(firstName)}`;
}
