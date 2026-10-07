import { AppShell } from "@/components/layout/app-shell";

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell topBar={<span className="text-sm font-medium">Pipindan Community MPC</span>}>
      {children}
    </AppShell>
  );
}
