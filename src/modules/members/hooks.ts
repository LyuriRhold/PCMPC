import type { Tx } from "@/db/client";
import type { MemberStatus } from "./schema";

/**
 * Listeners other modules register to react to a member's status change, inside the same
 * transaction (e.g. Water turns a terminated member's customer record into NON_MEMBER).
 */
export type MemberStatusListener = (tx: Tx, change: { memberId: string; from: MemberStatus; to: MemberStatus; actorId: string }) => Promise<void>;

const listeners = new Map<string, MemberStatusListener>();

export function onMemberStatusChange(name: string, listener: MemberStatusListener): void {
  listeners.set(name, listener);
}

export async function notifyMemberStatusChange(tx: Tx, change: Parameters<MemberStatusListener>[1]): Promise<void> {
  for (const listener of listeners.values()) await listener(tx, change);
}
