import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { guardPage } from "@/lib/page-guard";
import { listCategories } from "@/modules/store/service";
import { CategoryForm, CategoryRowForm } from "@/modules/store/ui/store-forms";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Product categories · PCMPC MIS" };

async function CategoriesContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const categories = await listCategories();
  const canEdit = can(access.user, "store.price");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Product categories</h1>
        <p className="text-sm text-muted-foreground">Groups for the product list and the store reports. A category no longer used is turned off, not deleted.</p>
      </div>
      <StoreTabs section="inventory" current="/store/inventory/categories" />
      {canEdit ? <CategoryForm /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.length === 0 ? (
            <TableRow>
              <TableCell className="text-center text-sm text-muted-foreground">No categories yet.</TableCell>
            </TableRow>
          ) : null}
          {categories.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{canEdit ? <CategoryRowForm category={{ id: c.id, name: c.name, isActive: c.isActive }} /> : `${c.name}${c.isActive ? "" : " (off)"}`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CategoriesContent />
    </Suspense>
  );
}
