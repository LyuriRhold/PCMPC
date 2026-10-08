import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPage } from "@/lib/page-guard";
import { PERMISSIONS } from "@/modules/auth/permissions";
import { listRolePermissions } from "@/modules/auth/service";

export const metadata: Metadata = { title: "Roles & permissions · PCMPC MIS" };

async function RolesContent() {
  const access = await guardPage("admin.users");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { roles, grants } = await listRolePermissions();
  const granted = new Set(grants);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Roles &amp; permissions</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. In v1 the matrix changes only through the seed (src/modules/auth/permissions.ts).
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">Permission</TableHead>
              {roles.map((r) => (
                <TableHead key={r.code} className="text-center text-xs" title={r.name}>
                  {r.code}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((p) => (
              <TableRow key={p}>
                <TableCell className="sticky left-0 bg-background font-mono text-xs">{p}</TableCell>
                {roles.map((r) => {
                  const has = granted.has(`${r.code}:${p}`);
                  return (
                    <TableCell key={r.code} className="text-center" aria-label={`${r.code} ${p} ${has ? "granted" : "not granted"}`}>
                      {has ? "✓" : ""}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RolesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <RolesContent />
    </Suspense>
  );
}
