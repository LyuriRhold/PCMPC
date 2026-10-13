import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { guardPage } from "@/lib/page-guard";
import { listCategories } from "@/modules/store/service";
import { ProductForm } from "@/modules/store/ui/store-forms";

export const metadata: Metadata = { title: "New product · PCMPC MIS" };

async function NewProductContent() {
  const access = await guardPage("store.price");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const categories = (await listCategories()).filter((c) => c.isActive);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/store/inventory" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Products &amp; inventory
        </Link>
        <h1 className="text-2xl font-semibold">New product</h1>
        <p className="text-sm text-muted-foreground">Stock starts at zero; it comes in through a receiving report.</p>
      </div>
      <ProductForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewProductContent />
    </Suspense>
  );
}
