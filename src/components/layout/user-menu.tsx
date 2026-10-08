import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/lib/auth-guard";
import { logoutAction } from "@/modules/auth/session-actions";

export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">
        <span className="font-medium">{user.name}</span>{" "}
        <span className="text-muted-foreground">({user.roleCode})</span>
      </span>
      <form action={logoutAction}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}
