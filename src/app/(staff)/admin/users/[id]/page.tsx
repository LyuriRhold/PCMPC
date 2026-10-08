import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { formatDateTime } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { ROLES } from "@/modules/auth/permissions";
import { getUser } from "@/modules/auth/service";
import { EditUserForm, ResetPasswordForm, UserStatusButton } from "@/modules/auth/ui/edit-user-forms";

export const metadata: Metadata = { title: "Edit user · PCMPC MIS" };

async function EditUserContent(props: PageProps<"/admin/users/[id]">) {
  const access = await guardPage("admin.users");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await getUser(id);
  if (!user) notFound();
  const isSelf = user.id === access.user.id;
  const editable = { id: user.id, username: user.username, name: user.name, email: user.email, roleCode: user.roleCode, isActive: user.isActive };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/admin/users" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Users
        </Link>
        <h1 className="text-2xl font-semibold">{user.username}</h1>
        <p className="text-sm text-muted-foreground">
          {user.isActive ? "Active" : "Inactive"} · created {formatDateTime(user.createdAt)}
          {user.lastLoginAt ? ` · last sign-in ${formatDateTime(user.lastLoginAt)}` : ""}
        </p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Details</h2>
        <EditUserForm user={editable} roles={ROLES.map((r) => ({ code: r.code, name: r.name }))} isSelf={isSelf} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Reset password</h2>
        <ResetPasswordForm userId={user.id} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Status</h2>
        <UserStatusButton user={editable} isSelf={isSelf} />
      </section>
    </div>
  );
}

export default function EditUserPage(props: PageProps<"/admin/users/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditUserContent {...props} />
    </Suspense>
  );
}
