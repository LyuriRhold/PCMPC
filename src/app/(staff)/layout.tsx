import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BusinessDateLabel } from "@/components/layout/business-date";
import { visibleHrefs } from "@/components/layout/nav";
import { UserMenu } from "@/components/layout/user-menu";
import { ViewAsBanner } from "@/components/layout/view-as";
import { ROLES } from "@/modules/auth/permissions";
import { getCurrentUser } from "@/lib/auth-guard";

/** Server-side session check for every staff page: no active user → /login. */
async function SignedInShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell
      allowed={visibleHrefs(user.permissions)}
      topBar={
        <>
          <BusinessDateLabel />
          <UserMenu user={user} />
        </>
      }
    >
      {user.actingAs ? <ViewAsBanner roleName={ROLES.find((r) => r.code === user.actingAs)?.name ?? user.actingAs} /> : null}
      {children}
    </AppShell>
  );
}

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>}
    >
      <SignedInShell>{children}</SignedInShell>
    </Suspense>
  );
}
