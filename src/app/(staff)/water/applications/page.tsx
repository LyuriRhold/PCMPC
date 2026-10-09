import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { guardPageAny } from "@/lib/page-guard";
import { APPLICATION_STATUSES } from "@/modules/water/schema";
import { listApplications } from "@/modules/water/queries";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Water applications · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({ status: one.pipe(z.enum(APPLICATION_STATUSES).optional().catch(undefined)) });

async function ApplicationsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["water.apply", "water.approve", "water.install"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const rows = await listApplications(f.status);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Connection applications</h1>
        <p className="text-sm text-muted-foreground">
          Applied → (inspected) → approved by the manager → fees paid at the teller → meter installed → account ACTIVE.
        </p>
      </div>
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Filter by status">
        <Link href="/water/applications" className={!f.status ? "font-semibold" : "underline underline-offset-4"}>
          Open
        </Link>
        {APPLICATION_STATUSES.map((s) => (
          <Link key={s} href={`/water/applications?status=${s}`} className={f.status === s ? "font-semibold" : "underline underline-offset-4"}>
            {s}
          </Link>
        ))}
      </nav>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application no.</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Service address</TableHead>
            <TableHead>Filed</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="sr-only">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No applications.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-xs">{a.appNo}</TableCell>
              <TableCell className="font-medium">{a.customerName}</TableCell>
              <TableCell className="text-xs">{a.classification}</TableCell>
              <TableCell>{a.serviceAddress}</TableCell>
              <TableCell className="tabular-nums">{formatDateTime(a.createdAt)}</TableCell>
              <TableCell>
                <WaterStatusBadge status={a.status} />
              </TableCell>
              <TableCell className="font-mono text-xs">{a.accountNo ?? "—"}</TableCell>
              <TableCell className="text-right">
                <Link href={`/water/applications/${a.id}`} className="text-sm underline underline-offset-4">
                  Review
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function WaterApplicationsPage(props: PageProps<"/water/applications">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApplicationsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
