import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getPo } from "@/modules/store/purchasing";
import { listProducts, listSuppliers } from "@/modules/store/service";
import { RrForm, type RrPo } from "@/modules/store/ui/purchasing-forms";

export const metadata: Metadata = { title: "Receive a delivery · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
/** "1,200.00" for the form (the action parses it back). */
const pesos = (m: bigint) => format(m).replace("₱", "");

async function NewRrContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("store.receive");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { po: poId } = z.object({ po: one.pipe(z.uuid().optional().catch(undefined)) }).parse(await searchParams);
  const data = poId ? await getPo(poId) : null;
  const po: RrPo | null =
    data && (data.po.status === "APPROVED" || data.po.status === "PARTIAL")
      ? {
          id: data.po.id,
          poNo: data.po.poNo,
          supplierId: data.supplier.id,
          supplierName: data.supplier.name,
          lines: data.lines.map((l) => ({ poLineId: l.line.id, productId: l.product.id, label: `${l.product.sku} · ${l.product.name}`, remaining: l.remaining, unitCost: pesos(l.line.unitCost) })),
        }
      : null;
  const [suppliers, products] = po ? [[], []] : await Promise.all([listSuppliers(), listProducts({ activeOnly: true })]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/store/purchasing/receiving" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Receiving
        </Link>
        <h1 className="text-2xl font-semibold">Receive a delivery{po ? ` · ${po.poNo}` : ""}</h1>
        <p className="text-sm text-muted-foreground">Count what arrived and enter the supplier&apos;s invoice prices. Posting adds the stock at cost and records what is owed the supplier.</p>
        {poId && !po ? <p className="text-sm text-destructive">That purchase order isn&apos;t approved or is already received.</p> : null}
      </div>
      <RrForm
        po={po}
        suppliers={suppliers.filter((s) => s.supplier.isActive).map((s) => ({ id: s.supplier.id, label: s.supplier.name }))}
        products={products.map((p) => ({ id: p.product.id, label: `${p.product.sku} · ${p.product.name}` }))}
      />
    </div>
  );
}

export default function NewRrPage(props: PageProps<"/store/purchasing/receiving/new">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewRrContent searchParams={props.searchParams} />
    </Suspense>
  );
}
