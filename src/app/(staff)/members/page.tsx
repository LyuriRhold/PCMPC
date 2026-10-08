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
import { formatDate } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { MEMBER_STATUSES } from "@/modules/members/schema";
import { searchMembers } from "@/modules/members/service";
import { selectClass } from "@/modules/members/ui/member-form";
import { MemberStatusBadge } from "@/modules/members/ui/status-badge";

export const metadata: Metadata = { title: "Members · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({
  q: one,
  status: one.pipe(z.enum(MEMBER_STATUSES).optional().catch(undefined)),
  type: one.pipe(z.enum(["REGULAR", "ASSOCIATE"]).optional().catch(undefined)),
  page: one.pipe(z.string().regex(/^\d{1,5}$/).transform(Number).optional().catch(undefined)),
});

async function MembersContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("members.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const result = await searchMembers({ q: f.q, status: f.status, type: f.type, page: f.page });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.q) q.set("q", f.q);
    if (f.status) q.set("status", f.status);
    if (f.type) q.set("type", f.type);
    q.set("page", String(p));
    return `/members?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Member registry</h1>
          <p className="text-sm text-muted-foreground">Members and applicants of the cooperative.</p>
        </div>
        {can(access.user, "members.write") ? (
          <Button nativeButton={false} render={<Link href="/members/new" />}>New application</Button>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search name or member no.</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="e.g. dela cruz, M-000001" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className={selectClass}>
            <option value="">All</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">Type</Label>
          <select id="type" name="type" defaultValue={f.type ?? ""} className={selectClass}>
            <option value="">All</option>
            <option value="REGULAR">Regular</option>
            <option value="ASSOCIATE">Associate</option>
          </select>
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        <Link href="/members" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} record{result.total === 1 ? "" : "s"} · page {result.page} of {pages}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member no.</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Barangay</TableHead>
            <TableHead>Member since</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No members match.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-mono text-xs">{m.memberNo ?? "—"}</TableCell>
              <TableCell>
                <Link href={`/members/${m.id}`} className="font-medium underline-offset-4 hover:underline">
                  {m.lastName}, {m.firstName}
                  {m.middleName ? ` ${m.middleName}` : ""}
                  {m.suffix ? ` ${m.suffix}` : ""}
                </Link>
              </TableCell>
              <TableCell className="text-xs">{m.type}</TableCell>
              <TableCell>
                <MemberStatusBadge status={m.status} />
              </TableCell>
              <TableCell>{m.addrBarangay}</TableCell>
              <TableCell className="tabular-nums">{m.membershipDate ? formatDate(m.membershipDate) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-3 text-sm">
        {result.page > 1 ? <Link href={href(result.page - 1)}>← Previous</Link> : null}
        {result.page < pages ? <Link href={href(result.page + 1)}>Next →</Link> : null}
      </div>
    </div>
  );
}

export default function MembersPage(props: PageProps<"/members">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MembersContent searchParams={props.searchParams} />
    </Suspense>
  );
}
