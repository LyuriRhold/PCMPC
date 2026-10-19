import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/lib/auth-guard";
import { ROLES } from "@/modules/auth/permissions";
import { logoutAction } from "@/modules/auth/session-actions";
import { ViewAsSelect } from "./view-as";

export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="hidden text-sm sm:inline">
        <span className="font-medium">{user.name}</span>{" "}
        <span className="text-muted-foreground">({user.actingAs ? `${user.roleCode}, viewing as` : user.roleCode})</span>
      </span>
      {user.realRoleCode === "ADMIN" ? <ViewAsSelect current={user.actingAs ?? "ADMIN"} roles={ROLES.map((r) => ({ code: r.code, name: r.name }))} /> : null}
      <form action={logoutAction}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}
