"use client";

import { now } from "@/lib/dates";

/**
 * The reading app's offline storage (IndexedDB): a queue of readings waiting to sync, and the
 * last route snapshot so the app still opens with no signal. Each queued reading carries a
 * client uuid; the server stores each uuid once, so a reading sent twice is harmless.
 */

export type QueuedReading = {
  clientUuid: string;
  periodId: string;
  accountId: string;
  accountNo: string;
  presentReading: number;
  rollover: boolean;
  remarks: string | null;
  readAt: string;
  /** Set when the server refused the reading (e.g. lower than previous); the reader re-reads it. */
  error?: string;
};

const DB = "pcmpc-reader";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "clientUuid" });
      if (!db.objectStoreNames.contains("snapshot")) db.createObjectStore("snapshot");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queueAll(): Promise<QueuedReading[]> {
  return ((await run<QueuedReading[]>("queue", "readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.readAt.localeCompare(b.readAt));
}

/** Queues a reading, replacing any unsynced reading of the same account and period. */
export async function queuePut(item: QueuedReading): Promise<void> {
  const stale = (await queueAll()).filter((q) => q.accountId === item.accountId && q.periodId === item.periodId && q.clientUuid !== item.clientUuid);
  await run("queue", "readwrite", (s) => {
    for (const q of stale) s.delete(q.clientUuid);
    s.put(item);
  });
}

export async function queueRemove(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  await run("queue", "readwrite", (s) => {
    for (const u of uuids) s.delete(u);
  });
}

export async function queueMarkErrors(errors: Array<{ clientUuid: string; error: string }>): Promise<void> {
  if (errors.length === 0) return;
  const all = await queueAll();
  await run("queue", "readwrite", (s) => {
    for (const e of errors) {
      const item = all.find((q) => q.clientUuid === e.clientUuid);
      if (item) s.put({ ...item, error: e.error });
    }
  });
}

export async function snapshotSave<T>(key: string, value: T): Promise<void> {
  await run("snapshot", "readwrite", (s) => {
    s.put({ value, savedAt: now().toISOString() }, key);
  });
}

export async function snapshotLoad<T>(key: string): Promise<{ value: T; savedAt: string } | null> {
  return ((await run<{ value: T; savedAt: string }>("snapshot", "readonly", (s) => s.get(key))) as { value: T; savedAt: string } | undefined) ?? null;
}
