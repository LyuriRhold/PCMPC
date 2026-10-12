import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { listProducts } from "@/modules/savings/service";
import { ProductForm } from "@/modules/savings/ui/savings-forms";
import { pct } from "@/modules/savings/ui/savings-panel";

export const metadata: Metadata = { title: "Savings products · PCMPC MIS" };

const pesos = (m: bigint) => format(m).replace("₱", "").replaceAll(",", "");

async function ProductsContent() {
  const access = await guardPageAny(["savings.read", "admin.settings"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const products = await listProducts();
  const canEdit = can(access.user, "admin.settings");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/savings" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Savings accounts
        </Link>
        <h1 className="text-2xl font-semibold">Savings products</h1>
        <p className="text-sm text-muted-foreground">
          The interest rates and limits of each deposit product. A new rate applies to the next interest run, which uses it for the whole quarter being run (savings), or to the next placement (time deposits); time deposits already placed keep their rate.
          {canEdit ? "" : " Only the administrator can change them."}
        </p>
      </div>
      {products.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {p.name}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {p.code} · {p.kind === "SAVINGS" ? "savings, interest credited every quarter" : "time deposit, interest at maturity"}
                {p.active ? "" : " · not offered"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <ProductForm
                product={{
                  id: p.id,
                  kind: p.kind,
                  name: p.name,
                  ratePct: pct(p.ratePa),
                  minBalanceEarn: pesos(p.minBalanceEarn),
                  maintainingBalance: pesos(p.maintainingBalance),
                  dormantAfterMonths: p.dormantAfterMonths,
                  wtaxPct: pct(p.wtaxRate),
                  active: p.active,
                }}
              />
            ) : (
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Interest rate</dt>
                  <dd>{pct(p.ratePa)}% a year</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Withholding tax on interest</dt>
                  <dd>{pct(p.wtaxRate)}%</dd>
                </div>
                {p.kind === "SAVINGS" ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Minimum average balance to earn</dt>
                      <dd>{format(p.minBalanceEarn)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Maintaining balance</dt>
                      <dd>{format(p.maintainingBalance)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Dormant after</dt>
                      <dd>{p.dormantAfterMonths} months without deposits or withdrawals</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SavingsProductsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProductsContent />
    </Suspense>
  );
}
