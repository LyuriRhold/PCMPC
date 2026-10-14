import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { currentShift, listShifts } from "@/modules/store/pos";
import { OpenShiftForm } from "@/modules/store/ui/pos-forms";
import { PosTerminal } from "@/modules/store/ui/pos-terminal";

export const metadata: Metadata = { title: "Point of sale · PCMPC MIS" };

async function PosContent() {
  const access = await guardPageAny(["store.pos", "store.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const user = access.user;
  const cashier = can(user, "store.pos");
  const [shift, shifts] = await Promise.all([cashier ? currentShift(user.id) : null, listShifts()]);
  const stale = shift && shift.businessDate !== businessToday();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Point of sale</h1>
          <p className="text-sm text-muted-foreground">
            {shift ? (
              <>
                Shift of {formatDate(shift.businessDate)} · opening fund {format(shift.openingFund)} ·{" "}
                <Link href={`/store/pos/shifts/${shift.id}`} className="underline underline-offset-4">
                  reading, sales and closing
                </Link>
              </>
            ) : (
              "Cash and member-charge sales. Each sale posts at once; voids need a supervisor; completed sales are corrected by a return."
            )}
          </p>
        </div>
      </div>

      {cashier && !shift ? <OpenShiftForm /> : null}
      {stale ? (
        <p className="text-sm text-destructive">
          Your shift of {formatDate(shift.businessDate)} is still open.{" "}
          <Link href={`/store/pos/shifts/${shift.id}`} className="underline underline-offset-4">
            Close it
          </Link>{" "}
          before selling today.
        </p>
      ) : null}
      {shift && !stale ? <PosTerminal /> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Shifts</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead className="text-right">Opening fund</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No shifts yet.
                </TableCell>
              </TableRow>
            ) : null}
            {shifts.map(({ shift: s, cashier: name }) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/store/pos/shifts/${s.id}`} className="underline-offset-4 hover:underline">
                    {formatDate(s.businessDate)}
                  </Link>
                </TableCell>
                <TableCell>{name}</TableCell>
                <TableCell className="text-right tabular-nums">{format(s.openingFund)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.variance === null ? "—" : format(s.variance)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{s.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

export default function PosPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PosContent />
    </Suspense>
  );
}
