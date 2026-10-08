"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { activateUserAction, deactivateUserAction, resetPasswordAction, updateUserAction } from "../actions";
import { selectClass } from "./create-user-form";

type EditableUser = { id: string; username: string; name: string; email: string | null; roleCode: string; isActive: boolean };

function Status({ error, done }: { error: string | null; done: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  return done ? <p className="text-sm text-green-700">{done}</p> : null;
}

export function EditUserForm({ user, roles, isSelf }: { user: EditableUser; roles: Array<{ code: string; name: string }>; isSelf: boolean }) {
  const { pending, error, done, run } = useAction();
  function submit(fd: FormData) {
    run(
      () =>
        updateUserAction({
          userId: user.id,
          fullName: String(fd.get("fullName") ?? ""),
          email: String(fd.get("email") ?? "") || null,
          roleCode: String(fd.get("roleCode") ?? ""),
        }),
      { success: "Saved." },
    );
  }
  return (
    <form action={submit} className="grid max-w-xl gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" defaultValue={user.name} required maxLength={120} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail (optional)</Label>
        <Input id="email" name="email" type="email" defaultValue={user.email ?? ""} maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="roleCode">Role</Label>
        <select id="roleCode" name="roleCode" defaultValue={user.roleCode} className={selectClass} disabled={isSelf}>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        {isSelf ? (
          <>
            <input type="hidden" name="roleCode" value={user.roleCode} />
            <p className="text-xs text-muted-foreground">You can&apos;t change your own role.</p>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Status error={error} done={done} />
      </div>
    </form>
  );
}

export function UserStatusButton({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const { pending, error, done, run } = useAction();
  if (isSelf) return <p className="text-sm text-muted-foreground">You can&apos;t deactivate yourself.</p>;
  const label = user.isActive ? "Deactivate user" : "Activate user";
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant={user.isActive ? "destructive" : "default"}
        disabled={pending}
        onClick={() => {
          if (user.isActive && !window.confirm(`Deactivate ${user.username}? They will be signed out.`)) return;
          run(() => (user.isActive ? deactivateUserAction({ userId: user.id }) : activateUserAction({ userId: user.id })), {
            success: user.isActive ? "User deactivated." : "User activated.",
          });
        }}
      >
        {label}
      </Button>
      <Status error={error} done={done} />
    </div>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, done, run } = useAction();
  function submit(fd: FormData) {
    run(() => resetPasswordAction({ userId, password: String(fd.get("password") ?? "") }), {
      success: "Password reset. The user was signed out everywhere.",
      onSuccess: () => form.current?.reset(),
    });
  }
  return (
    <form ref={form} action={submit} className="flex max-w-xl flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Resetting…" : "Reset password"}
        </Button>
        <Status error={error} done={done} />
      </div>
    </form>
  );
}
