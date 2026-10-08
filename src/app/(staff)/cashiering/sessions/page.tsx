import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { listSessions } from "@/modules/cashiering/queries";
import { VerifySessionButton } from "@/modules/cashiering/ui/buttons";

export const metadata: Metadata = { title: "Teller sessions · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const schema = z.object({ date: one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined)) });

async function SessionsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["cash.verify", "cash.cancel"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = schema.parse(await searchParams);
  const rows = await listSessions({ date: f.date });
  const canVerify = can(access.user, "cash.verify");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Teller sessions</h1>
        <p className="text-sm text-muted-foreground">Verify closed sessions. A short or over is posted to Cash Short/Over on verification.</p>
      </div>
      <form method="get" className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Business date</Label>
          <Input id="date" name="date" type="date" defaultValue={f.date ?? ""} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
        <Link href="/cashiering/sessions" className="text-sm underline underline-offset-4">
          All recent
        </Link>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Teller</TableHead>
            <TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="sr-only">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No sessions.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="tabular-nums">{formatDate(s.businessDate)}</TableCell>
              <TableCell>
                {s.tellerName} <span className="text-xs text-muted-foreground">({s.tellerUsername})</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(s.openingCash)}</TableCell>
              <TableCell className="text-right tabular-nums">{s.expectedCash === null ? "" : format(s.expectedCash)}</TableCell>
              <TableCell className="text-right tabular-nums">{s.countedCash === null ? "" : format(s.countedCash)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", s.variance && s.variance !== 0n ? "text-destructive" : "")}>
                {s.variance === null ? "" : format(s.variance)}
              </TableCell>
              <TableCell className="text-xs">
                {s.status}
                {s.verifiedByName ? ` · ${s.verifiedByName}` : ""}
              </TableCell>
              <TableCell className="text-right">
                {s.status === "CLOSED" && canVerify && s.tellerId !== access.user.id ? <VerifySessionButton sessionId={s.id} /> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SessionsPage(props: PageProps<"/cashiering/sessions">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SessionsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
