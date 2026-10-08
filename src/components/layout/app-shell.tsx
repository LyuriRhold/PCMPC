import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";

export function AppShell({ allowed, topBar, children }: { allowed: string[]; topBar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-14 items-center border-b border-sidebar-border px-5">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-sidebar-foreground">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              PC
            </span>
            PCMPC MIS
          </Link>
        </div>
        <SidebarNav allowed={allowed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4 md:px-6">
          <MobileNav allowed={allowed} />
          {topBar}
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
