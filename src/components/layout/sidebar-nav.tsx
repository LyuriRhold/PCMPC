"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Longest matching href wins, so /savings/interest doesn't also light up /savings. */
function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs.filter((h) => isActive(pathname, h)).sort((a, b) => b.length - a.length)[0];
}

export function SidebarNav({ allowed, onNavigate }: { allowed: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => allowed.includes(i.href)) })).filter(
    (s) => s.items.length > 0,
  );
  const current = activeHref(pathname, allowed);

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3 py-4">
      {sections.map((section) => (
        <details key={section.title} open className="group/section">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/60 hover:text-sidebar-foreground [&::-webkit-details-marker]:hidden">
            {section.title}
            <ChevronDown className="size-3.5 transition-transform group-open/section:rotate-0 -rotate-90" aria-hidden />
          </summary>
          <div className="mb-2 flex flex-col gap-0.5">
            {section.items.map(({ href, label, icon: Icon, status }) => {
              const active = href === current;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    status === "soon" && "text-sidebar-foreground/60",
                    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{label}</span>
                  {status === "soon" ? (
                    <span className="rounded-full border border-sidebar-border px-1.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
                      Soon
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </details>
      ))}
    </nav>
  );
}
