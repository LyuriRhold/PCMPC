import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";

export function AppShell({ allowed, topBar, children }: { allowed: string[]; topBar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-14 items-center border-b border-sidebar-border px-5">
          <span className="text-sm font-semibold text-sidebar-foreground">PCMPC MIS</span>
        </div>
        <SidebarNav allowed={allowed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-6">{topBar}</header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
