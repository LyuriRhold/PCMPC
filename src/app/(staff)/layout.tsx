import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BusinessDateLabel } from "@/components/layout/business-date";

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      topBar={
        <>
          <span className="text-sm font-medium">Pipindan Community MPC</span>
          <Suspense fallback={<span className="text-sm text-muted-foreground">Business date: …</span>}>
            <BusinessDateLabel />
          </Suspense>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
