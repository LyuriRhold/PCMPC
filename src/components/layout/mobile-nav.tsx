"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./sidebar-nav";

/** Below the md breakpoint the sidebar is hidden; this button opens it as an overlay. */
export function MobileNav({ allowed }: { allowed: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
        <Menu className="size-5" aria-hidden />
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="h-full w-72 overflow-y-auto border-r border-sidebar-border bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-5">
              <span className="text-sm font-semibold text-sidebar-foreground">PCMPC MIS</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <SidebarNav allowed={allowed} onNavigate={() => setOpen(false)} />
          </div>
          <button type="button" className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
