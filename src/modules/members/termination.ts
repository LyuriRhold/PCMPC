import type { Db, Tx } from "@/db/client";

/**
 * Extensible termination check (`canTerminate`). Each money module registers a rule that returns
 * a blocking reason (e.g. "has an active loan") or null. Phase 02 registers none; Phases 08, 09
 * and 11 add share capital, savings and loan rules.
 */
export type TerminationRule = {
  name: string;
  check: (memberId: string, db: Db | Tx) => Promise<string | null>;
};

const rules: TerminationRule[] = [];

export function registerTerminationRule(rule: TerminationRule): void {
  const i = rules.findIndex((r) => r.name === rule.name);
  if (i >= 0) rules[i] = rule;
  else rules.push(rule);
}

export function unregisterTerminationRule(name: string): void {
  const i = rules.findIndex((r) => r.name === name);
  if (i >= 0) rules.splice(i, 1);
}

export function terminationRuleNames(): string[] {
  return rules.map((r) => r.name);
}

export async function canTerminate(memberId: string, db: Db | Tx): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  for (const rule of rules) {
    const reason = await rule.check(memberId, db);
    if (reason) reasons.push(reason);
  }
  return { ok: reasons.length === 0, reasons };
}
