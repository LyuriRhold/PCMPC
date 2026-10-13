"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { changePriceAction, createCategoryAction, createProductAction, createSupplierAction, updateCategoryAction, updateProductAction, updateSupplierAction } from "../actions";

export function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function Done({ done }: { done: string | null }) {
  return done ? <p className="text-sm text-green-700 dark:text-green-400">{done}</p> : null;
}

function Field({ id, label, children, className }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export const VAT_LABEL: Record<string, string> = { VAT: "VAT", VAT_EXEMPT: "VAT-exempt", ZERO_RATED: "Zero-rated" };

type Category = { id: string; name: string };
export type ProductValues = { id: string; sku: string; barcode: string | null; name: string; unit: string; categoryId: string | null; reorderLevel: number; vatClass: "VAT" | "VAT_EXEMPT" | "ZERO_RATED"; isActive: boolean };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string) => {
  const t = str(fd, k).replace(/,/g, "");
  return /^\d+$/.test(t) ? Number(t) : -1;
};

/** Manager: a new product (with its selling price) or a product's details. */
export function ProductForm({ categories, product }: { categories: Category[]; product?: ProductValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  function submit(fd: FormData) {
    setError(null);
    setDone(null);
    const fields = {
      sku: str(fd, "sku"),
      barcode: str(fd, "barcode") || null,
      name: str(fd, "name"),
      unit: str(fd, "unit"),
      categoryId: str(fd, "categoryId") || null,
      reorderLevel: int(fd, "reorderLevel"),
      vatClass: str(fd, "vatClass") as ProductValues["vatClass"],
    };
    startTransition(async () => {
      if (product) {
        const r = await updateProductAction({ ...fields, id: product.id, isActive: fd.get("isActive") === "on" });
        if (!r.ok) return setError(r.error);
        setDone("Saved.");
        router.refresh();
      } else {
        const r = await createProductAction({ ...fields, sellingPrice: str(fd, "sellingPrice") });
        if (!r.ok) return setError(r.error);
        router.push(`/store/inventory/${r.data.id}`);
      }
    });
  }
  return (
    <form action={submit} className="grid gap-3 sm:grid-cols-2">
      <Field id="sku" label="SKU">
        <Input id="sku" name="sku" defaultValue={product?.sku} maxLength={40} required />
      </Field>
      <Field id="barcode" label="Barcode (optional)">
        <Input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} maxLength={40} />
      </Field>
      <Field id="name" label="Name" className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={product?.name} maxLength={120} required />
      </Field>
      <Field id="unit" label="Unit">
        <Input id="unit" name="unit" defaultValue={product?.unit ?? "pc"} maxLength={20} placeholder="pc, pack, sack, kg" />
      </Field>
      <Field id="categoryId" label="Category">
        <select id="categoryId" name="categoryId" className={selectClass} defaultValue={product?.categoryId ?? ""}>
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {product ? null : (
        <Field id="sellingPrice" label="Selling price (₱)">
          <Input id="sellingPrice" name="sellingPrice" inputMode="decimal" required />
        </Field>
      )}
      <Field id="reorderLevel" label="Reorder level">
        <Input id="reorderLevel" name="reorderLevel" inputMode="numeric" defaultValue={String(product?.reorderLevel ?? 0)} />
      </Field>
      <Field id="vatClass" label="VAT class">
        <select id="vatClass" name="vatClass" className={selectClass} defaultValue={product?.vatClass ?? "VAT_EXEMPT"}>
          {Object.entries(VAT_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {product ? (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="isActive" defaultChecked={product.isActive} /> Active (sold and ordered)
        </label>
      ) : null}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <div>
          <Button type="submit" disabled={pending}>
            Save product
          </Button>
        </div>
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Manager: a new selling price (kept in the history). */
export function PriceForm({ productId }: { productId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => changePriceAction({ productId, price: str(fd, "newPrice") }), { success: "Price changed." })}>
      <Field id="newPrice" label="New selling price (₱)">
        <Input id="newPrice" name="newPrice" inputMode="decimal" className="w-36" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Change price
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Manager: a new product category. */
export function CategoryForm() {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => createCategoryAction({ name: str(fd, "categoryName") }))}>
      <Field id="categoryName" label="Category name">
        <Input id="categoryName" name="categoryName" maxLength={80} className="w-64" />
      </Field>
      <Button type="submit" disabled={pending}>
        Add category
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Manager: renames a category or turns it off. */
export function CategoryRowForm({ category }: { category: Category & { isActive: boolean } }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-center gap-2" action={(fd) => run(() => updateCategoryAction({ id: category.id, name: str(fd, "name"), isActive: fd.get("isActive") === "on" }))}>
      <Input name="name" aria-label={`Name of ${category.name}`} defaultValue={category.name} maxLength={80} className="w-56" />
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={category.isActive} /> Active
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Err error={error} />
    </form>
  );
}

export type SupplierValues = { id: string; name: string; contact: string | null; tin: string | null; termsDays: number; isActive: boolean };

/** Store clerk: a new supplier, or a supplier's details. */
export function SupplierForm({ supplier }: { supplier?: SupplierValues }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => {
        const fields = { name: str(fd, "supplierName"), contact: str(fd, "contact") || null, tin: str(fd, "tin") || null, termsDays: int(fd, "termsDays") };
        if (supplier) run(() => updateSupplierAction({ ...fields, id: supplier.id, isActive: fd.get("isActive") === "on" }), { success: "Saved." });
        else run(() => createSupplierAction(fields), { success: "Supplier added." });
      }}
    >
      <Field id="supplierName" label="Supplier name">
        <Input id="supplierName" name="supplierName" defaultValue={supplier?.name} maxLength={120} className="w-64" />
      </Field>
      <Field id="contact" label="Contact (person, phone)">
        <Input id="contact" name="contact" defaultValue={supplier?.contact ?? ""} maxLength={120} className="w-56" />
      </Field>
      <Field id="tin" label="TIN (optional)">
        <Input id="tin" name="tin" defaultValue={supplier?.tin ?? ""} maxLength={20} className="w-40" />
      </Field>
      <Field id="termsDays" label="Terms (days)">
        <Input id="termsDays" name="termsDays" inputMode="numeric" defaultValue={String(supplier?.termsDays ?? 30)} className="w-24" />
      </Field>
      {supplier ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={supplier.isActive} /> Active
        </label>
      ) : null}
      <Button type="submit" disabled={pending}>
        {supplier ? "Save supplier" : "Add supplier"}
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
