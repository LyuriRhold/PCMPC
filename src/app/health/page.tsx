import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDate } from "@/lib/dates";
import { healthReport } from "@/lib/health";

export const metadata: Metadata = { title: "System health · PCMPC MIS" };

async function HealthDetails() {
  await connection();
  const report = await healthReport();
  return (
    <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Database</dt>
      <dd data-testid="db-status" className={report.db.ok ? "font-medium text-green-700" : "font-medium text-destructive"}>
        {report.db.ok ? "DB: OK" : `DB: ERROR (${report.db.error})`}
      </dd>
      <dt className="text-muted-foreground">Business date</dt>
      <dd data-testid="business-date" className="tabular-nums">
        {formatDate(report.businessDate)}
      </dd>
      <dt className="text-muted-foreground">Version</dt>
      <dd data-testid="app-version">{report.version}</dd>
      <dt className="text-muted-foreground">Environment</dt>
      <dd data-testid="app-env">{report.environment}</dd>
    </dl>
  );
}

export default function HealthPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">System health</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Checking…</p>}>
        <HealthDetails />
      </Suspense>
    </main>
  );
}
