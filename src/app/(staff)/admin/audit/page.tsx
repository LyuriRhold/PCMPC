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
import { formatDateTime, isBusinessDate } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { auditFilterOptions, listAuditLog } from "@/modules/audit/service";

export const metadata: Metadata = { title: "Audit log · PCMPC MIS" };

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({
  user: one.pipe(z.uuid().optional().catch(undefined)),
  entity: one,
  action: one,
  from: one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined)),
  to: one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined)),
  page: one.pipe(
    z
      .string()
      .regex(/^\d{1,6}$/)
      .transform(Number)
      .refine((n) => n >= 1)
      .optional()
      .catch(undefined),
  ),
});

async function AuditContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("audit.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const [result, options] = await Promise.all([
    listAuditLog({
      userId: f.user,
      entity: f.entity || undefined,
      action: f.action || undefined,
      from: f.from,
      to: f.to,
      page: f.page,
    }),
    auditFilterOptions(),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (f.user) q.set("user", f.user);
    if (f.entity) q.set("entity", f.entity);
    if (f.action) q.set("action", f.action);
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
    q.set("page", String(p));
    return `/admin/audit?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Append-only record of every change, sign-in and denied action.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-user">User</Label>
          <select id="f-user" name="user" defaultValue={f.user ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-entity">Entity</Label>
          <select id="f-entity" name="entity" defaultValue={f.entity ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-action">Action</Label>
          <select id="f-action" name="action" defaultValue={f.action ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={f.from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={f.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          Filter
        </Button>
        <Link href="/admin/audit" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} entr{result.total === 1 ? "y" : "ies"} · page {result.page} of {pages}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (Manila)</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((r) => (
            <TableRow key={r.id} className="align-top">
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</TableCell>
              <TableCell>{r.username ?? "system"}</TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="text-xs">
                {r.entity}
                {r.entityId ? <span className="block text-muted-foreground">{r.entityId}</span> : null}
              </TableCell>
              <TableCell className="max-w-md">
                {r.before || r.after ? (
                  <details>
                    <summary className="cursor-pointer text-xs underline underline-offset-4">before / after</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">{r.ip ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-3 text-sm">
        {result.page > 1 ? <Link href={pageHref(result.page - 1)}>← Newer</Link> : null}
        {result.page < pages ? <Link href={pageHref(result.page + 1)}>Older →</Link> : null}
      </div>
    </div>
  );
}

export default function AuditPage(props: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AuditContent searchParams={props.searchParams} />
    </Suspense>
  );
}
