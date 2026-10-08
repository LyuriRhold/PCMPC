"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

export function SidebarNav({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => allowed.includes(i.href)) })).filter(
    (s) => s.items.length > 0,
  );
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/60">
            {section.title}
          </p>
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
