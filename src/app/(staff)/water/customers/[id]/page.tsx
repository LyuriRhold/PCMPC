import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { getCustomer, listRoutes } from "@/modules/water/queries";
import { ApplicationForm } from "@/modules/water/ui/forms";
import { WATER_STAFF, WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Water customer · PCMPC MIS" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

async function CustomerContent(props: PageProps<"/water/customers/[id]">) {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getCustomer(id, can(access.user, "members.read_sensitive"));
  if (!data) notFound();
  const { customer: c, accounts, applications } = data;
  const routes = await listRoutes();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/water/customers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Water customers
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <Badge variant="outline">{c.type === "MEMBER" ? "Member" : "Non-member"}</Badge>
        </div>
        <p className="font-mono text-sm text-muted-foreground">{c.customerNo}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row label="Address" value={c.address} />
            <Row label="Mobile no." value={c.mobile} />
            <Row label="E-mail" value={c.email} />
            <Row label="Valid ID" value={c.validIdType ? `${c.validIdType} ${c.validIdNo ?? ""}` : null} />
            <Row
              label="Member record"
              value={
                c.memberId ? (
                  <Link href={`/members/${c.memberId}`} className="underline underline-offset-4">
                    Open member profile
                  </Link>
                ) : null
              }
            />
            <Row label="Privacy consent" value={c.privacyConsentAt ? formatDateTime(c.privacyConsentAt) : "Not recorded"} />
            <Row label="Remarks" value={c.remarks} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account no.</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Service address</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead className="text-right">Deposit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No service accounts yet. An account opens when an application is approved.
                  </TableCell>
                </TableRow>
              ) : null}
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/water/connections/${a.id}`} className="underline-offset-4 hover:underline">
                      {a.accountNo}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{a.classification}</TableCell>
                  <TableCell>{a.serviceAddress}</TableCell>
                  <TableCell className="tabular-nums">{a.connectedAt ? formatDate(a.connectedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(a.depositAmount)}</TableCell>
                  <TableCell>
                    <WaterStatusBadge status={a.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection applications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {can(access.user, "water.apply") ? <ApplicationForm customerId={c.id} routes={routes} /> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application no.</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Service address</TableHead>
                <TableHead>Filed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No applications.
                  </TableCell>
                </TableRow>
              ) : null}
              {applications.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/water/applications/${a.id}`} className="underline-offset-4 hover:underline">
                      {a.appNo}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{a.classification}</TableCell>
                  <TableCell>{a.serviceAddress}</TableCell>
                  <TableCell className="tabular-nums">{formatDateTime(a.createdAt)}</TableCell>
                  <TableCell>
                    <WaterStatusBadge status={a.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WaterCustomerPage(props: PageProps<"/water/customers/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CustomerContent {...props} />
    </Suspense>
  );
}
