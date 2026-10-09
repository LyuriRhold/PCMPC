"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { now } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { syncReadingsAction } from "../billing-actions";
import { consumptionFor, flagsFor, type FlagRules } from "../consumption";
import { queueAll, queueMarkErrors, queuePut, queueRemove, snapshotLoad, snapshotSave, type QueuedReading } from "./reader-store";

export type ReaderAccount = {
  accountId: string;
  accountNo: string;
  sequenceNo: number;
  customerName: string;
  serviceAddress: string;
  meterSerial: string;
  digits: number;
  previous: number;
  average: number | null;
  estimatedSince: number;
  readPresent: number | null;
};

export type ReaderRoute = {
  routeId: string;
  routeCode: string;
  routeName: string;
  zoneCode: string;
  period: { id: string; period: string } | null;
  accounts: ReaderAccount[];
};

type Snapshot = { routes: ReaderRoute[]; rules: FlagRules };

const SNAPSHOT = "routes";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Live check of a typed reading: consumption and warnings (the server re-checks on sync). */
function check(a: ReaderAccount, present: number | null, rollover: boolean, rules: FlagRules) {
  if (present === null) return null;
  try {
    const r = consumptionFor({ previous: a.previous, present, digits: a.digits, rollover, estimatedSince: a.estimatedSince });
    const history = a.average === null ? [] : [a.average];
    return { consumption: r.consumption, flags: flagsFor({ consumption: r.consumption, history, rollover }, rules), error: null };
  } catch (e) {
    return { consumption: null, flags: [], error: e instanceof Error ? e.message : "Check the reading" };
  }
}

const FLAG_TEXT: Record<string, string> = {
  HIGH: "Much higher than usual: re-check the dial",
  LOW: "Much lower than usual",
  ZERO: "No consumption",
  LOWER: "Rollover: the meter passed its maximum",
};

export function ReaderApp({ initial, readerName }: { initial: Snapshot; readerName: string }) {
  const router = useRouter();
  const [data, setData] = useState<Snapshot>(initial);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [queue, setQueue] = useState<QueuedReading[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [routeId, setRouteId] = useState(initial.routes[0]?.routeId ?? "");
  const [current, setCurrent] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [rollover, setRollover] = useState(false);
  const [remarks, setRemarks] = useState("");

  const refreshQueue = useCallback(async () => setQueue(await queueAll()), []);

  // Keep the latest route data on the phone; fall back to it when the page came from the cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (navigator.onLine) await snapshotSave(SNAPSHOT, initial);
      else {
        const saved = await snapshotLoad<Snapshot>(SNAPSHOT);
        if (saved && !cancelled) setData(saved.value);
      }
      if (!cancelled) await refreshQueue();
    })();
    return () => {
      cancelled = true;
    };
  }, [initial, refreshQueue]);

  const flush = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    const items = (await queueAll()).filter((q) => !q.error);
    if (items.length === 0) return;
    setSyncing(true);
    try {
      const r = await syncReadingsAction({
        items: items.map((q) => ({ clientUuid: q.clientUuid, periodId: q.periodId, accountId: q.accountId, presentReading: q.presentReading, rollover: q.rollover, remarks: q.remarks, readAt: q.readAt })),
      });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      await queueRemove(r.data.filter((x) => x.status !== "error").map((x) => x.clientUuid));
      await queueMarkErrors(r.data.filter((x) => x.status === "error").map((x) => ({ clientUuid: x.clientUuid, error: x.error ?? "Not saved" })));
      const errors = r.data.filter((x) => x.status === "error").length;
      setMessage(errors ? `${errors} reading${errors === 1 ? "" : "s"} need re-checking` : "All readings synced");
      router.refresh();
    } catch {
      setMessage("No signal: readings are kept on this phone and will sync later");
    } finally {
      setSyncing(false);
      await refreshQueue();
    }
  }, [refreshQueue, router, syncing]);

  // Sync when the signal returns, every minute, and on open.
  useEffect(() => {
    const goOnline = () => void flush();
    window.addEventListener("online", goOnline);
    const timer = window.setInterval(() => void flush(), 60_000);
    const first = window.setTimeout(() => void flush(), 0);
    return () => {
      window.removeEventListener("online", goOnline);
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [flush]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const route = data.routes.find((r) => r.routeId === routeId) ?? data.routes[0];
  const account = route?.accounts.find((a) => a.accountId === current) ?? null;
  const queuedFor = useMemo(() => new Map(queue.map((q) => [q.accountId, q])), [queue]);
  const present = typed === "" ? null : Number(typed);
  const live = account ? check(account, present, rollover, data.rules) : null;

  function openAccount(a: ReaderAccount) {
    const q = queuedFor.get(a.accountId);
    setCurrent(a.accountId);
    setTyped(q ? String(q.presentReading) : a.readPresent !== null ? String(a.readPresent) : "");
    setRollover(q?.rollover ?? false);
    setRemarks(q?.remarks ?? "");
  }

  async function save() {
    if (!account || !route?.period || present === null || live?.error) return;
    await queuePut({
      clientUuid: uuid(),
      periodId: route.period.id,
      accountId: account.accountId,
      accountNo: account.accountNo,
      presentReading: present,
      rollover,
      remarks: remarks.trim() || null,
      readAt: now().toISOString(),
    });
    await refreshQueue();
    const i = route.accounts.findIndex((a) => a.accountId === account.accountId);
    const nextAccount = route.accounts.slice(i + 1).find((a) => a.readPresent === null && !queuedFor.has(a.accountId));
    if (nextAccount) openAccount(nextAccount);
    else setCurrent(null);
    void flush();
  }

  const key = (k: string) => {
    if (k === "⌫") setTyped((t) => t.slice(0, -1));
    else if (k === "C") setTyped("");
    else setTyped((t) => (t.length >= 9 ? t : (t === "0" ? "" : t) + k));
  };

  const waiting = queue.filter((q) => !q.error).length;
  const failed = queue.filter((q) => q.error);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 p-3">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Meter reading</h1>
          <p className="text-xs text-muted-foreground">{readerName}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <span data-testid="connection" className={online ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
            {online ? "Online" : "Offline"}
          </span>
          <span data-testid="queue-count">{waiting ? `${waiting} waiting to sync` : "Nothing waiting"}</span>
        </div>
      </header>

      {message ? (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}
      {failed.length ? (
        <div className="rounded-md border border-destructive/50 p-2 text-sm">
          <p className="font-medium">Re-check these readings:</p>
          <ul className="list-disc pl-5">
            {failed.map((f) => (
              <li key={f.clientUuid}>
                {f.accountNo}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.routes.length === 0 ? <p className="text-sm text-muted-foreground">No routes are assigned to you. Ask the billing clerk to assign your route.</p> : null}

      {data.routes.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {data.routes.map((r) => (
            <Button key={r.routeId} type="button" size="sm" variant={r.routeId === route?.routeId ? "default" : "outline"} onClick={() => (setRouteId(r.routeId), setCurrent(null))}>
              {r.routeCode}
            </Button>
          ))}
        </div>
      ) : null}

      {route ? (
        <p className="text-sm">
          <span className="font-medium">
            {route.routeCode} · {route.routeName}
          </span>{" "}
          <span className="text-muted-foreground">{route.period ? `· period ${route.period.period}` : "· no open billing period"}</span>
        </p>
      ) : null}

      {account && route?.period ? (
        <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label={`Reading ${account.accountNo}`}>
          <div>
            <p className="font-mono text-xs">
              #{account.sequenceNo} · {account.accountNo} · meter {account.meterSerial}
            </p>
            <p className="font-medium">{account.customerName}</p>
            <p className="text-xs text-muted-foreground">{account.serviceAddress}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              Previous <span className="block text-lg font-semibold tabular-nums">{account.previous.toLocaleString("en-US")}</span>
            </div>
            <div>
              3-month avg <span className="block text-lg font-semibold tabular-nums">{account.average === null ? "—" : `${account.average} m³`}</span>
            </div>
          </div>
          <output aria-label="Present reading" className="block rounded-md border bg-muted px-3 py-2 text-right font-mono text-4xl tabular-nums">
            {typed || " "}
          </output>
          {live?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {live.error}
            </p>
          ) : live ? (
            <p className="text-sm">
              Used <span className="font-semibold">{live.consumption} m³</span>
              {live.flags.map((f) => (
                <span key={f} className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  {FLAG_TEXT[f] ?? f}
                </span>
              ))}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
              <Button key={k} type="button" variant="outline" className="h-14 text-2xl" aria-label={k === "⌫" ? "Delete digit" : k === "C" ? "Clear" : k} onClick={() => key(k)}>
                {k}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} className="size-5" /> Meter rolled over (passed its maximum)
          </label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={300} placeholder="Remarks (optional)" aria-label="Remarks" className="h-10 rounded-md border bg-transparent px-3 text-sm" />
          <div className="flex gap-2">
            <Button type="button" className="h-12 flex-1 text-base" disabled={present === null || !!live?.error} onClick={() => void save()}>
              Save reading
            </Button>
            <Button type="button" variant="outline" className="h-12" onClick={() => setCurrent(null)}>
              Back
            </Button>
          </div>
        </section>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {route?.accounts.map((a) => {
            const q = queuedFor.get(a.accountId);
            const state = q?.error ? "Re-check" : q ? `Queued ${q.presentReading.toLocaleString("en-US")}` : a.readPresent !== null ? `Read ${a.readPresent.toLocaleString("en-US")}` : "To read";
            return (
              <li key={a.accountId}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left" onClick={() => openAccount(a)} disabled={!route.period}>
                  <span>
                    <span className="block font-mono text-xs">
                      #{a.sequenceNo} · {a.accountNo}
                    </span>
                    <span className="block text-sm font-medium">{a.customerName}</span>
                    <span className="block text-xs text-muted-foreground">{a.serviceAddress}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${q?.error ? "text-destructive" : q ? "text-amber-700 dark:text-amber-400" : a.readPresent !== null ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="outline" disabled={!online || syncing || waiting === 0} onClick={() => void flush()}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </div>
  );
}
