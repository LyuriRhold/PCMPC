import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { listAccounts } from "@/modules/ledger/coa-admin";
import { AddAccountForm, RenameAccount, ToggleAccountActive } from "@/modules/ledger/ui/coa-forms";

export const metadata: Metadata = { title: "Chart of accounts · PCMPC MIS" };

async function CoaContent() {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const rows = await listAccounts();
  const canEdit = can(access.user, "gl.coa");
  const provisional = rows.some((r) => r.provisional);
  const headers = rows.filter((r) => !r.isPostable && r.isActive).map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Chart of accounts</h1>
        <p className="text-sm text-muted-foreground">
          Accounts with a balance or a posting key can&apos;t be deactivated. Posting keys link each transaction type to
          its account (DOMAIN §6).
        </p>
      </div>

      {provisional ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          This is a <strong>provisional</strong> chart of accounts. Replace it with PCMPC&apos;s actual COA (see
          docs/coa/README.md) before go-live.
        </p>
      ) : null}

      {canEdit ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Add an account</h2>
          <AddAccountForm headers={headers} />
        </section>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Code</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Posting keys</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => {
            const balance = a.normalBalance === "DR" ? a.net : -a.net;
            return (
              <TableRow key={a.id} className={cn(!a.isActive && "opacity-50")}>
                <TableCell className="font-mono text-xs">{a.code}</TableCell>
                <TableCell>
                  <span style={{ paddingLeft: `${(a.level - 1) * 1.25}rem` }} className={cn(!a.isPostable && "font-semibold")}>
                    {a.name}
                  </span>
                  {a.provisional ? (
                    <Badge variant="secondary" className="ml-2">
                      Provisional
                    </Badge>
                  ) : null}
                  {a.requiresMember ? (
                    <Badge variant="outline" className="ml-2">
                      Member ledger
                    </Badge>
                  ) : null}
                  {!a.isActive ? (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {a.type} · {a.normalBalance}
                </TableCell>
                <TableCell className="font-mono text-xs">{a.mappingKeys.join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{a.isPostable && a.net !== 0n ? format(balance) : ""}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    <div className="flex items-start justify-end gap-1">
                      <RenameAccount accountId={a.id} name={a.name} scaCode={a.scaCode} parentId={a.parentId} />
                      <ToggleAccountActive accountId={a.id} active={a.isActive} label={`${a.code} ${a.name}`} />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CoaPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CoaContent />
    </Suspense>
  );
}
