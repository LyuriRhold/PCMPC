import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { guardPageAny } from "@/lib/page-guard";
import { periodGrid } from "@/modules/water/billing-queries";
import { ReadingRow, type GridRowView } from "@/modules/water/ui/billing-forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Reading entry · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function GridContent(props: PageProps<"/water/readings/[id]">) {
  const access = await guardPageAny(["water.bill", "water.review_readings"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const show = one.parse((await props.searchParams).show);
  const grid = await periodGrid(id);
  if (!grid) notFound();
  const { period } = grid;
  const open = period.status !== "BILLED" && period.status !== "CLOSED";
  const canEnter = can(access.user, "water.bill");
  const canReview = can(access.user, "water.review_readings");
  const all = grid.routes.flatMap((r) => r.rows);
  const flagged = all.filter((r) => r.reading?.status === "ENTERED").length;
  const unread = all.filter((r) => !r.reading && !r.excluded).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/water/readings" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Meter readings
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {period.period} · {period.zone.code} {period.zone.name}
          </h1>
          <WaterStatusBadge status={period.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Reading window {formatDate(period.readingFrom)} – {formatDate(period.readingTo)} · bill date {formatDate(period.billDate)} · due {formatDate(period.dueDate)}. {all.length} account
          {all.length === 1 ? "" : "s"}, {unread} not read, {flagged} flagged for review.
        </p>
        <p className="text-sm">
          {show === "flagged" ? (
            <Link href={`/water/readings/${id}`} className="underline underline-offset-4">
              Show all accounts
            </Link>
          ) : (
            <Link href={`/water/readings/${id}?show=flagged`} className="underline underline-offset-4">
              Show flagged readings only ({flagged})
            </Link>
          )}
          {" · "}
          <Link href={`/water/billing/${id}`} className="underline underline-offset-4">
            Billing run
          </Link>
        </p>
        {open && canEnter ? <p className="text-xs text-muted-foreground">Type a reading and press Enter to save it and move to the next account. Tick R if the meter rolled over.</p> : null}
      </div>

      {grid.routes.map((route) => {
        const rows: GridRowView[] = route.rows
          .filter((r) => show !== "flagged" || r.reading?.status === "ENTERED")
          .map((r) => ({
            accountId: r.accountId,
            accountNo: r.accountNo,
            sequenceNo: r.sequenceNo,
            customerName: r.customerName,
            meterSerial: r.meterSerial,
            previous: r.previous,
            average: r.average,
            note: r.meterChanged ? "Meter changed since the last reading" : r.estimatedSince ? `${r.estimatedSince} m³ estimated since the last actual reading` : r.status !== "ACTIVE" ? r.status : null,
            excluded: r.excluded,
            reading: r.reading
              ? { id: r.reading.id, presentReading: r.reading.presentReading, consumption: r.reading.consumption, type: r.reading.type, flags: r.reading.flags, status: r.reading.status, rollover: r.reading.rollover }
              : null,
          }));
        return (
          <Card key={route.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {route.code} · {route.name}
                </span>
                <a href={`/api/water/periods/${id}/sheet?route=${route.id}`} target="_blank" rel="noreferrer" className="text-sm font-normal underline underline-offset-4">
                  Reading sheet {route.code} (PDF)
                </a>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-1.5">Seq.</th>
                    <th className="px-2 py-1.5">Account no.</th>
                    <th className="px-2 py-1.5">Customer</th>
                    <th className="px-2 py-1.5">Meter</th>
                    <th className="px-2 py-1.5 text-right">Previous</th>
                    <th className="px-2 py-1.5 text-right">3-mo avg</th>
                    <th className="px-2 py-1.5">Present</th>
                    <th className="px-2 py-1.5 text-right">Used</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5 sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-3 text-center text-muted-foreground">
                        {show === "flagged" ? "No flagged readings on this route." : "No accounts on this route."}
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((row) => (
                    <ReadingRow key={`${row.accountId}-${row.reading?.id ?? "none"}-${row.reading?.status ?? ""}`} periodId={id} row={row} canEnter={canEnter} canReview={canReview} open={open} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function ReadingGridPage(props: PageProps<"/water/readings/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <GridContent {...props} />
    </Suspense>
  );
}
