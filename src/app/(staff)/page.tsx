import { getCurrentUser } from "@/lib/auth-guard";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";

async function DashboardContent() {
  const user = await getCurrentUser();
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome{user ? `, ${user.name}` : ""}. Modules appear in the sidebar as each phase is completed.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
