import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { accountMappings, accounts, ACCOUNT_TYPES, NORMAL_BALANCES, type AccountType, type NormalBalance } from "./schema";
import { MEMBER_SUBSIDIARY_KEYS, PROVISIONAL_COA, REQUIRED_MAPPING_KEYS, type CoaRow } from "./provisional-coa";

export class CoaError extends Error {
  override name = "CoaError";
}

/** Where the bookkeeper's chart of accounts goes (format: docs/coa/README.md). */
export const COA_CSV_PATH = join("docs", "coa", "pcmpc-coa.csv");

const HEADER = ["code", "name", "type", "normal_balance", "parent_code", "postable", "sca_code", "mapping_keys"];

/** Splits one CSV line, honouring double-quoted fields ("Customers' Deposits, Water"). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parses and validates a chart-of-accounts CSV. Errors name the line. */
export function parseCoaCsv(text: string): CoaRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  if (HEADER.some((h, i) => header[i] !== h)) {
    throw new CoaError(`COA CSV header must be: ${HEADER.join(",")}`);
  }
  const rows: CoaRow[] = [];
  const codes = new Set<string>();
  lines.slice(1).forEach((line, i) => {
    const n = i + 2;
    const [code = "", name = "", type = "", nb = "", parentCode = "", postable = "", scaCode = "", keys = ""] = splitCsvLine(line);
    if (!code || !name) throw new CoaError(`line ${n}: code and name are required`);
    if (codes.has(code)) throw new CoaError(`line ${n}: duplicate code ${code}`);
    if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) throw new CoaError(`line ${n}: type must be one of ${ACCOUNT_TYPES.join("|")}`);
    if (!(NORMAL_BALANCES as readonly string[]).includes(nb)) throw new CoaError(`line ${n}: normal_balance must be DR or CR`);
    if (!/^(true|false|yes|no|y|n|1|0)$/i.test(postable)) throw new CoaError(`line ${n}: postable must be true or false`);
    codes.add(code);
    rows.push({
      code,
      name,
      type: type as AccountType,
      normalBalance: nb as NormalBalance,
      parentCode: parentCode || null,
      isPostable: /^(true|yes|y|1)$/i.test(postable),
      scaCode: scaCode || null,
      mappingKeys: keys ? keys.split(";").map((k) => k.trim()).filter(Boolean) : [],
    });
  });
  for (const r of rows) {
    if (r.parentCode && !codes.has(r.parentCode)) throw new CoaError(`account ${r.code}: parent ${r.parentCode} is not in the file`);
    if (r.mappingKeys.length && !r.isPostable) throw new CoaError(`account ${r.code}: mapping keys need a postable account`);
  }
  const mapped = rows.flatMap((r) => r.mappingKeys);
  const dupKey = mapped.find((k, i) => mapped.indexOf(k) !== i);
  if (dupKey) throw new CoaError(`mapping key ${dupKey} is assigned to more than one account`);
  return rows;
}

/** Keys from REQUIRED_MAPPING_KEYS that a chart doesn't map. */
export function missingMappingKeys(rows: CoaRow[]): string[] {
  const mapped = new Set(rows.flatMap((r) => r.mappingKeys));
  return REQUIRED_MAPPING_KEYS.filter((k) => !mapped.has(k));
}

/**
 * Inserts accounts (parents first) and their mapping keys. Existing codes and keys are left as
 * they are, so re-running is safe and never overwrites edits made in the COA screen.
 */
export async function importCoa(tx: Tx, rows: CoaRow[], opts: { provisional: boolean }): Promise<{ accounts: number; mappings: number }> {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const levelOf = (r: CoaRow, depth = 0): number => {
    if (depth > 20) throw new CoaError(`account ${r.code}: parent chain is circular`);
    const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
    return parent ? levelOf(parent, depth + 1) + 1 : 1;
  };
  const ordered = [...rows].sort((a, b) => levelOf(a) - levelOf(b));
  let inserted = 0;
  for (const r of ordered) {
    const [parent] = r.parentCode ? await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, r.parentCode)) : [];
    const res = await tx
      .insert(accounts)
      .values({
        code: r.code,
        name: r.name,
        type: r.type,
        normalBalance: r.normalBalance,
        parentId: parent?.id ?? null,
        level: levelOf(r),
        isPostable: r.isPostable,
        scaCode: r.scaCode,
        provisional: opts.provisional,
      })
      .onConflictDoNothing({ target: accounts.code })
      .returning({ id: accounts.id });
    inserted += res.length;
  }
  let mapped = 0;
  const codes = rows.filter((r) => r.mappingKeys.length).map((r) => r.code);
  const ids = codes.length ? await tx.select({ id: accounts.id, code: accounts.code }).from(accounts).where(inArray(accounts.code, codes)) : [];
  const idByCode = new Map(ids.map((a) => [a.code, a.id]));
  for (const r of rows) {
    for (const key of r.mappingKeys) {
      const accountId = idByCode.get(r.code);
      if (!accountId) continue;
      const res = await tx
        .insert(accountMappings)
        .values({ key, accountId, requiresMember: (MEMBER_SUBSIDIARY_KEYS as readonly string[]).includes(key) })
        .onConflictDoNothing({ target: accountMappings.key })
        .returning({ id: accountMappings.id });
      mapped += res.length;
    }
  }
  return { accounts: inserted, mappings: mapped };
}

/**
 * Seed step: imports docs/coa/pcmpc-coa.csv when present; otherwise loads the provisional COA
 * (flagged provisional) so postings can work until PCMPC supplies its chart (Q-03.1).
 */
export async function seedCoa(tx: Tx): Promise<void> {
  if (existsSync(COA_CSV_PATH)) {
    const rows = parseCoaCsv(readFileSync(COA_CSV_PATH, "utf8"));
    const missing = missingMappingKeys(rows);
    if (missing.length) throw new CoaError(`${COA_CSV_PATH} does not map: ${missing.join(", ")}`);
    await importCoa(tx, rows, { provisional: false });
  } else {
    await importCoa(tx, PROVISIONAL_COA, { provisional: true });
  }
}
