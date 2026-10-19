import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { guardPage } from "@/lib/page-guard";
import { REPORTS } from "@/modules/reports/operational";

export const metadata: Metadata = { title: "Reports · PCMPC MIS" };

async function ReportsContent() {
  const access = await guardPage("reports.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Operational reports for management and the board, each with an Excel export. Totals are checked against the books where they apply.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.key} size="sm">
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/reports/operational/${r.key}`} className="underline underline-offset-4">
                  {r.title}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{r.description}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReportsContent />
    </Suspense>
  );
}
