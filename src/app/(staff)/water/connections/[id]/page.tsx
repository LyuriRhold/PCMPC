import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { accountBills } from "@/modules/water/billing-queries";
import { getAccount, listRoutes } from "@/modules/water/queries";
import { CloseAccountForm } from "@/modules/water/ui/billing-forms";
import { ActivateButton, MoveRouteForm, ReplaceMeterForm, SeniorForm, TransferForm } from "@/modules/water/ui/forms";
import { WATER_STAFF, WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Service account · PCMPC MIS" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

async function AccountContent(props: PageProps<"/water/connections/[id]">) {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const d = await getAccount(id, can(access.user, "members.read_sensitive"));
  if (!d) notFound();
  const { account: a, customer: c, current } = d;
  const [routes, bills] = await Promise.all([listRoutes(), accountBills(id)]);
  const today = businessToday();
  const open = a.status !== "CLOSED";
  const canInstall = can(access.user, "water.install");
  const canCustomers = can(access.user, "water.customers");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/water/connections" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Connections &amp; meters
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Account {a.accountNo}</h1>
          <WaterStatusBadge status={a.status} />
          {a.status === "PENDING" && canInstall && current ? <ActivateButton accountId={a.id} /> : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row
              label="Customer"
              value={
                <Link href={`/water/customers/${c.id}`} className="underline underline-offset-4">
                  {c.name} ({c.customerNo})
                </Link>
              }
            />
            <Row label="Mobile no." value={c.mobile} />
            <Row label="Classification" value={a.classification} />
            <Row label="Service address" value={a.serviceAddress} />
            <Row label="Route / sequence" value={`${d.route.code} · ${d.route.name} · #${a.sequenceNo}`} />
            <Row label="Connected" value={a.connectedAt ? formatDate(a.connectedAt) : null} />
            <Row label="Meter deposit held" value={format(a.depositAmount)} />
            <Row label="Current meter" value={current ? `${current.serialNo} since ${formatDate(current.inst.installedAt)} (initial reading ${current.inst.initialReading})` : "None installed"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Meter history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meter</TableHead>
                <TableHead>Installed</TableHead>
                <TableHead className="text-right">Initial reading</TableHead>
                <TableHead>Removed</TableHead>
                <TableHead className="text-right">Final reading</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.installations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No meter installed yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {d.installations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.serialNo}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(i.installedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.initialReading}</TableCell>
                  <TableCell className="tabular-nums">{i.removedAt ? formatDate(i.removedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.finalReading ?? "—"}</TableCell>
                  <TableCell>{i.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canInstall && current && open ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Replace the meter</summary>
              <div className="pt-3">
                <ReplaceMeterForm accountId={a.id} />
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senior-citizen discount eligibility (RA 9994)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Senior citizen</TableHead>
                <TableHead>OSCA ID no.</TableHead>
                <TableHead>Valid from</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Today</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.seniors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No eligibility records.
                  </TableCell>
                </TableRow>
              ) : null}
              {d.seniors.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.seniorName}</TableCell>
                  <TableCell className="font-mono text-xs">{s.oscaIdNo}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(s.validFrom)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(s.validUntil)}</TableCell>
                  <TableCell className="text-xs">{s.validFrom <= today && s.validUntil >= today ? "Valid" : "Not valid"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canCustomers && a.classification === "RESIDENTIAL" && open ? <SeniorForm accountId={a.id} /> : null}
          {a.classification !== "RESIDENTIAL" ? <p className="text-sm text-muted-foreground">Only RESIDENTIAL accounts qualify for the senior-citizen discount.</p> : null}
        </CardContent>
      </Card>

      {canCustomers && open ? (
        <Card>
          <CardHeader>
            <CardTitle>Route and ownership</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <MoveRouteForm accountId={a.id} routeId={a.routeId} routes={routes} />
            <TransferForm accountId={a.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill no.</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">m³</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Total due</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No bills yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {bills.map(({ bill: b, period }) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/water/bills/${b.id}`} className="underline-offset-4 hover:underline">
                      {b.billNo}
                    </Link>
                    {b.isFinal ? " (final)" : ""}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{period}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.consumption}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.currentAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.totalAmountDue)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(b.dueDate)}</TableCell>
                  <TableCell>
                    <WaterStatusBadge status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {can(access.user, "water.disconnect") && (a.status === "ACTIVE" || a.status === "DISCONNECTED") ? (
        <Card>
          <CardHeader>
            <CardTitle>Close the account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Takes the final reading in the zone&apos;s open billing period, posts the final bill now, removes the meter and closes the account. The deposit refund comes with
              collections (Phase 07).
            </p>
            <CloseAccountForm accountId={a.id} accountNo={a.accountNo} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Account history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular-nums">{formatDateTime(h.at)}</TableCell>
                  <TableCell className="text-xs">{h.event}</TableCell>
                  <TableCell>{h.fromValue ?? "—"}</TableCell>
                  <TableCell>{h.toValue ?? "—"}</TableCell>
                  <TableCell>{h.event === "SENIOR_ELIGIBILITY" ? "—" : (h.ref ?? "—")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountPage(props: PageProps<"/water/connections/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AccountContent {...props} />
    </Suspense>
  );
}
