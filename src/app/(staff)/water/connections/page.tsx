import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { listAccounts, listMeters } from "@/modules/water/queries";
import { AddMeterForm, MeterStatusSelect } from "@/modules/water/ui/forms";
import { WATER_STAFF, WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Connections & meters · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function ConnectionsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const q = one.parse((await searchParams).q);
  const [accounts, meters] = await Promise.all([listAccounts({ q }), listMeters()]);
  const canInstall = can(access.user, "water.install");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Connections &amp; meters</h1>
        <p className="text-sm text-muted-foreground">Service accounts and the meter inventory.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service accounts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <Label htmlFor="q">Find account no. or customer name</Label>
              <Input id="q" name="q" defaultValue={q ?? ""} placeholder="e.g. WA-000001, santos" />
            </div>
            <Button type="submit" size="sm">
              Find
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account no.</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Meter</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead className="text-right">Deposit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No service accounts.
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
                  <TableCell>{a.customerName}</TableCell>
                  <TableCell className="text-xs">{a.classification}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.routeCode} #{a.sequenceNo}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.meterSerial ?? "—"}</TableCell>
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
          <CardTitle>Meter inventory</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canInstall ? <AddMeterForm /> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial no.</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Digits</TableHead>
                <TableHead>Installed at</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {meters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No meters in the inventory.
                  </TableCell>
                </TableRow>
              ) : null}
              {meters.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.serialNo}</TableCell>
                  <TableCell>{m.brand ?? "—"}</TableCell>
                  <TableCell>{m.size ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{m.digits}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {m.installedAt ? (
                      <Link href={`/water/connections/${m.installedAt.accountId}`} className="underline-offset-4 hover:underline">
                        {m.installedAt.accountNo}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {canInstall && m.status !== "INSTALLED" ? <MeterStatusSelect meterId={m.id} status={m.status} serialNo={m.serialNo} /> : <WaterStatusBadge status={m.status} />}
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

export default function ConnectionsPage(props: PageProps<"/water/connections">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ConnectionsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
