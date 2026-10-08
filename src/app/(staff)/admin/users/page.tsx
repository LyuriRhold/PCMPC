import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, now } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { ROLES } from "@/modules/auth/permissions";
import { listUsers } from "@/modules/auth/service";
import { CreateUserForm } from "@/modules/auth/ui/create-user-form";

export const metadata: Metadata = { title: "Users · PCMPC MIS" };

async function UsersContent() {
  const access = await guardPage("admin.users");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const users = await listUsers();
  const at = now();
  const roleName = new Map<string, string>(ROLES.map((r) => [r.code, r.name]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Staff accounts. Users are deactivated, never deleted.</p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">New user</h2>
        <CreateUserForm roles={ROLES.map((r) => ({ code: r.code, name: r.name }))} />
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>Full name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const locked = !!u.lockedUntil && u.lockedUntil > at;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell>{roleName.get(u.roleCode) ?? u.roleCode}</TableCell>
                <TableCell>
                  {!u.isActive ? (
                    <Badge variant="secondary">Inactive</Badge>
                  ) : locked ? (
                    <Badge variant="destructive">Locked</Badge>
                  ) : (
                    <Badge variant="outline">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</TableCell>
                <TableCell className="text-right">
                  <Link className="text-sm underline underline-offset-4" href={`/admin/users/${u.id}`}>
                    Edit
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <UsersContent />
    </Suspense>
  );
}
