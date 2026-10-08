import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_SECTIONS, visibleHrefs } from "@/components/layout/nav";
import { getCurrentUser } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { ROLES } from "@/modules/auth/permissions";

async function DashboardContent() {
  const user = await getCurrentUser();
  const allowed = new Set(visibleHrefs(user?.permissions ?? new Set()));
  const sections = NAV_SECTIONS.filter((s) => s.title !== "General")
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed.has(i.href)) }))
    .filter((s) => s.items.length > 0);
  const items = sections.flatMap((s) => s.items);
  const live = items.filter((i) => i.status === "live").length;
  const roleName = ROLES.find((r) => r.code === user?.roleCode)?.name ?? user?.roleCode;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome{user ? `, ${user.name}` : ""}. Today is {formatDate(businessToday())}
          {roleName ? <> · signed in as {roleName}</> : null}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Ready to use</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{live}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Coming soon</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{items.length - live}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Main service</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Water billing for member and non-member connections arrives in Phases 05–07.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {sections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SectionIcon className="size-4 text-muted-foreground" aria-hidden />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="flex items-start gap-3 py-2 hover:bg-muted/50 rounded-md px-1 -mx-1"
                        >
                          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-medium">{item.label}</span>
                            <span className="text-xs text-muted-foreground">{item.summary}</span>
                          </span>
                          {item.status === "live" ? (
                            <Badge variant="outline" className="shrink-0 border-green-600/40 text-green-700">
                              Live
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="shrink-0">
                              Soon · P{item.phase}
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
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
