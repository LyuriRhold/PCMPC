import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { guardPageAny } from "@/lib/page-guard";
import { getApplication } from "@/modules/water/queries";
import { ApplicationDecision, InstallForm } from "@/modules/water/ui/forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Water application · PCMPC MIS" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function Paid({ ok }: { ok: boolean }) {
  return ok ? <span className="text-green-700 dark:text-green-400">Paid</span> : <span className="text-amber-700 dark:text-amber-400">Not yet paid</span>;
}

async function ApplicationContent(props: PageProps<"/water/applications/[id]">) {
  const access = await guardPageAny(["water.apply", "water.approve", "water.install"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const d = await getApplication(id);
  if (!d) notFound();
  const a = d.application;
  const open = a.status === "APPLIED" || a.status === "INSPECTED";
  const isEncoder = a.encodedBy === access.user.id;
  const canApprove = open && can(access.user, "water.approve") && !isEncoder;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/water/applications" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Connection applications
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Application {a.appNo}</h1>
          <WaterStatusBadge status={a.status} />
        </div>
      </div>

      {a.status === "APPROVED" && d.account ? (
        <p className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm dark:bg-green-950/30">
          Approved: account {d.account.accountNo} (PENDING). Collect the connection fee and meter deposit at the teller, then install the meter.
        </p>
      ) : null}
      {a.status === "INSTALLED" && d.account ? (
        <p className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm dark:bg-green-950/30">
          Installed: account {d.account.accountNo} is {d.account.status}.{" "}
          <Link href={`/water/connections/${d.account.id}`} className="underline underline-offset-4">
            Open the account
          </Link>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Application</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row
              label="Customer"
              value={
                <Link href={`/water/customers/${d.customer.id}`} className="underline underline-offset-4">
                  {d.customer.name} ({d.customer.customerNo})
                </Link>
              }
            />
            <Row label="Classification" value={a.classification} />
            <Row label="Service address" value={a.serviceAddress} />
            <Row label="Reading route" value={d.route ? `${d.route.code} · ${d.route.name}` : "Default route"} />
            <Row label="Encoded" value={`${d.encodedByName ?? ""} · ${formatDateTime(a.createdAt)}`} />
            <Row label="Inspection" value={a.inspectedAt ? `${d.inspectedByName ?? ""} · ${formatDateTime(a.inspectedAt)}${a.inspectionNotes ? ` · ${a.inspectionNotes}` : ""}` : null} />
            <Row label="Approved" value={a.approvedAt ? `${d.approvedByName ?? ""} · ${formatDateTime(a.approvedAt)}` : null} />
            <Row label="Installed" value={a.installedAt ? formatDate(a.installedAt) : null} />
            {a.status === "REJECTED" ? <Row label="Rejected because" value={a.rejectedReason} /> : null}
          </dl>
        </CardContent>
      </Card>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {isEncoder && can(access.user, "water.approve") ? (
              <p className="text-sm text-muted-foreground">You encoded this application, so another approver must decide it (segregation of duties).</p>
            ) : null}
            {canApprove || can(access.user, "water.install") ? (
              <ApplicationDecision applicationId={a.id} canInspect={can(access.user, "water.install")} canApprove={canApprove} inspected={a.status === "INSPECTED"} />
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for inspection and the manager&apos;s approval.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {a.status === "APPROVED" ? (
        <Card>
          <CardHeader>
            <CardTitle>Fees and installation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-2 sm:grid-cols-2">
              <Row label="Connection fee" value={<Paid ok={d.connectionFeePaid} />} />
              <Row label="Meter deposit" value={<Paid ok={d.depositPaid} />} />
            </dl>
            {can(access.user, "water.install") ? <InstallForm applicationId={a.id} /> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function WaterApplicationPage(props: PageProps<"/water/applications/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApplicationContent {...props} />
    </Suspense>
  );
}
