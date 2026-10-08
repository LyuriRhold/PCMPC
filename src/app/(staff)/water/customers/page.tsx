import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { guardPageAny } from "@/lib/page-guard";
import { searchCustomers } from "@/modules/water/queries";
import { WATER_STAFF, WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Water customers · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({
  q: one,
  page: one.pipe(z.string().regex(/^\d{1,5}$/).transform(Number).optional().catch(undefined)),
});

async function CustomersContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const result = await searchCustomers({ q: f.q, page: f.page });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => `/water/customers?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), page: String(p) }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Water customers</h1>
          <p className="text-sm text-muted-foreground">Members and non-members with water service or a pending application.</p>
        </div>
        {can(access.user, "water.customers") ? (
          <Button nativeButton={false} render={<Link href="/water/customers/new" />}>
            New customer
          </Button>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search name, customer no. or account no.</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="e.g. santos, WC-000001, WA-000001" />
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        <Link href="/water/customers" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} customer{result.total === 1 ? "" : "s"} · page {result.page} of {pages}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer no.</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Accounts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No customers match.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">{c.customerNo}</TableCell>
              <TableCell>
                <Link href={`/water/customers/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{c.type === "MEMBER" ? "Member" : "Non-member"}</Badge>
              </TableCell>
              <TableCell className="max-w-72 truncate">{c.address}</TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-2">
                  {c.accounts.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                  {c.accounts.map((a) => (
                    <span key={a.accountNo} className="flex items-center gap-1 font-mono text-xs">
                      {a.accountNo} <WaterStatusBadge status={a.status} />
                    </span>
                  ))}
                </span>
              </TableCell>
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

export default function WaterCustomersPage(props: PageProps<"/water/customers">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CustomersContent searchParams={props.searchParams} />
    </Suspense>
  );
}
