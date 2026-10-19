import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPageAny } from "@/lib/page-guard";
import { searchMembers } from "@/modules/members/service";

export const metadata: Metadata = { title: "Member statements · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function StatementsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["members.read", "reports.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { q } = z.object({ q: one }).parse(await searchParams);
  const found = q?.trim() ? await searchMembers({ q, pageSize: 50 }) : null;
  const rows = found ? found.rows.filter((m) => m.memberNo) : [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Member statements</h1>
        <p className="text-sm text-muted-foreground">A member&apos;s statement of account: share capital, savings, time deposits, loans and the store account, checked against the books. Print it or save it as PDF.</p>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="q">Member</label>
        <input id="q" name="q" defaultValue={q ?? ""} placeholder="Name or member no." className="h-8 w-72 rounded-md border bg-background px-2" />
        <button type="submit" className="underline underline-offset-4">
          Find
        </button>
      </form>
      {found ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member no.</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No approved member matches.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.memberNo}</TableCell>
                <TableCell>
                  {m.lastName}, {m.firstName}
                </TableCell>
                <TableCell>{m.status}</TableCell>
                <TableCell>
                  <Link href={`/reports/statements/${m.id}`} className="underline underline-offset-4">
                    Statement
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}

export default function StatementsPage(props: PageProps<"/reports/statements">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <StatementsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
