import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { getSetting } from "@/modules/settings/service";
import { disconnectionList, openNotices } from "@/modules/water/collections";
import { CancelNoticeButton, IssueNoticeButton, OrderForm } from "@/modules/water/ui/collection-forms";

export const metadata: Metadata = { title: "Disconnections · PCMPC MIS" };

async function DisconnectionsContent() {
  const access = await guardPageAny(["water.disconnect", "water.reconnect"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const today = businessToday();
  const [list, min, days] = await Promise.all([disconnectionList(), getSetting("water.disconnect_after_bills"), getSetting("water.notice_days")]);
  const open = await openNotices();
  const canDisconnect = can(access.user, "water.disconnect");
  const canReconnect = can(access.user, "water.reconnect");
  const noticed = open.filter((o) => o.status === "NOTICED");
  const disconnected = open.filter((o) => o.status === "DISCONNECTED");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Disconnections</h1>
        <p className="text-sm text-muted-foreground">
          Accounts with {min} or more unpaid bills get a notice; after {days} days they can be disconnected (with a meter reading). Reconnection needs all arrears, penalties and the
          reconnection fee paid at the teller.
        </p>
        <p className="text-sm">
          <Link href="/water/reports?report=disconnection-list" className="underline underline-offset-4">
            Print the disconnection list
          </Link>
          {" · "}
          <Link href="/water/reports?report=reconnection-log" className="underline underline-offset-4">
            Reconnection log
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>For disconnection ({list.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Service address</TableHead>
                <TableHead className="text-right">Unpaid bills</TableHead>
                <TableHead className="text-right">Amount due</TableHead>
                <TableHead>Notice</TableHead>
                <TableHead className="sr-only">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No accounts are due for disconnection.
                  </TableCell>
                </TableRow>
              ) : null}
              {list.map((l) => (
                <TableRow key={l.accountId}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/water/connections/${l.accountId}`} className="underline-offset-4 hover:underline">
                      {l.accountNo}
                    </Link>
                  </TableCell>
                  <TableCell>{l.customerName}</TableCell>
                  <TableCell>{l.serviceAddress}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.unpaidBills}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(l.outstanding)}</TableCell>
                  <TableCell className="text-xs">{l.notice ? `${l.notice.noticeNo} · until ${formatDate(l.notice.scheduledDate)}` : "—"}</TableCell>
                  <TableCell className="text-right">{canDisconnect && !l.notice ? <IssueNoticeButton accountId={l.accountId} accountNo={l.accountNo} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notices issued ({noticed.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notice</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Pay by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noticed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No open notices.
                  </TableCell>
                </TableRow>
              ) : null}
              {noticed.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">
                    <a href={`/api/water/disconnections/${d.id}/notice`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                      {d.noticeNo}
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.accountNo}</TableCell>
                  <TableCell>{d.customerName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(d.noticeDate)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(d.scheduledDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(d.noticeAmount)}</TableCell>
                  <TableCell className="text-right">
                    {canDisconnect ? (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {today >= d.scheduledDate ? <OrderForm disconnectionId={d.id} accountNo={d.accountNo} kind="disconnect" /> : <span className="text-xs text-muted-foreground">Can disconnect from {formatDate(d.scheduledDate)}</span>}
                        <CancelNoticeButton disconnectionId={d.id} noticeNo={d.noticeNo} />
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disconnected ({disconnected.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notice</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Disconnected</TableHead>
                <TableHead className="text-right">Reading</TableHead>
                <TableHead className="sr-only">Reconnect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {disconnected.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No disconnected accounts.
                  </TableCell>
                </TableRow>
              ) : null}
              {disconnected.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.noticeNo}</TableCell>
                  <TableCell className="font-mono text-xs">{d.accountNo}</TableCell>
                  <TableCell>{d.customerName}</TableCell>
                  <TableCell className="tabular-nums">{d.disconnectedAt ? formatDate(d.disconnectedAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.disconnectReading ?? "—"}</TableCell>
                  <TableCell className="text-right">{canReconnect ? <OrderForm disconnectionId={d.id} accountNo={d.accountNo} kind="reconnect" /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DisconnectionsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DisconnectionsContent />
    </Suspense>
  );
}
