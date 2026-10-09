import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { guardPageAny } from "@/lib/page-guard";
import { routesWithAccounts } from "@/modules/water/queries";
import { RouteSequence } from "@/modules/water/ui/forms";
import { WATER_STAFF } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Zones & routes · PCMPC MIS" };

async function RoutesContent() {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const zones = await routesWithAccounts();
  const canEdit = can(access.user, "water.customers");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Zones &amp; routes</h1>
        <p className="text-sm text-muted-foreground">
          Reading routes and the order meter readers visit each account.{canEdit ? " Drag rows (or use ↑/↓) to change the order, then save." : ""}
        </p>
      </div>
      {zones.length === 0 ? <p className="text-sm text-muted-foreground">No zones set up.</p> : null}
      {zones.map((z) => (
        <section key={z.id} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {z.name} <span className="font-mono text-sm text-muted-foreground">{z.code}</span>
          </h2>
          {z.routes.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle>
                  {r.code} · {r.name} <span className="text-sm font-normal text-muted-foreground">({r.accounts.length} account{r.accounts.length === 1 ? "" : "s"})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RouteSequence key={r.accounts.map((a) => a.id).join(",")} routeId={r.id} accounts={r.accounts} canEdit={canEdit} />
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function RoutesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <RoutesContent />
    </Suspense>
  );
}
