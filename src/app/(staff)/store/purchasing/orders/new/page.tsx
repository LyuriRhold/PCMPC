import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { guardPage } from "@/lib/page-guard";
import { listProducts, listSuppliers } from "@/modules/store/service";
import { PoForm } from "@/modules/store/ui/purchasing-forms";

export const metadata: Metadata = { title: "New purchase order · PCMPC MIS" };

async function NewPoContent() {
  const access = await guardPage("store.receive");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [suppliers, products] = await Promise.all([listSuppliers(), listProducts({ activeOnly: true })]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/store/purchasing" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Purchasing
        </Link>
        <h1 className="text-2xl font-semibold">New purchase order</h1>
        <p className="text-sm text-muted-foreground">Saved as a draft for the manager&apos;s approval. Unit costs are the supplier&apos;s prices per unit.</p>
      </div>
      <PoForm
        suppliers={suppliers.filter((s) => s.supplier.isActive).map((s) => ({ id: s.supplier.id, label: s.supplier.name }))}
        products={products.map((p) => ({ id: p.product.id, label: `${p.product.sku} · ${p.product.name}` }))}
      />
    </div>
  );
}

export default function NewPoPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewPoContent />
    </Suspense>
  );
}
