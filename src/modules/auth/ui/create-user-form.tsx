"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { createUserAction } from "../actions";

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateUserForm({ roles }: { roles: Array<{ code: string; name: string }> }) {
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, done, run } = useAction();

  function submit(fd: FormData) {
    run(
      () =>
        createUserAction({
          username: String(fd.get("username") ?? ""),
          fullName: String(fd.get("fullName") ?? ""),
          email: String(fd.get("email") ?? "") || null,
          roleCode: String(fd.get("roleCode") ?? ""),
          password: String(fd.get("password") ?? ""),
        }),
      { success: "User created.", onSuccess: () => form.current?.reset() },
    );
  }

  return (
    <form ref={form} action={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" name="username" required minLength={3} maxLength={30} autoCapitalize="none" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-fullName">Full name</Label>
        <Input id="new-fullName" name="fullName" required maxLength={120} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">E-mail (optional)</Label>
        <Input id="new-email" name="email" type="email" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-role">Role</Label>
        <select id="new-role" name="roleCode" required className={selectClass} defaultValue="">
          <option value="" disabled>
            Choose a role
          </option>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Initial password</Label>
        <Input id="new-password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {done ? <p className="text-sm text-green-700">{done}</p> : null}
      </div>
    </form>
  );
}
