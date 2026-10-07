import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BusinessDateLabel } from "@/components/layout/business-date";
import { visibleHrefs } from "@/components/layout/nav";
import { UserMenu } from "@/components/layout/user-menu";
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
