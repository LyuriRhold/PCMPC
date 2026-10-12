"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { addMonths } from "@/lib/dates";
import { format, parse } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import { borrowerLookupAction, cancelApplicationAction, decideApplicationAction, submitApplicationAction, updateLoanProductAction } from "../actions";
import { netProceeds, schedule, scheduleTotals, type AmortizationMethod } from "../amortization";
import { ScheduleTable } from "./schedule-table";

function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  method: AmortizationMethod;
  ratePm: string;
  minTerm: number;
  maxTerm: number;
  maxAmount: string | null;
  maxMultipleOfPaidUp: string | null;
  requiredComakers: number;
  deductions: Array<{ code: string; name: string; basis: "PCT_OF_PRINCIPAL" | "FIXED"; value: string; glKey: string }>;
};

type Found = { id: string; memberNo: string | null; name: string; status: string; goodStanding: boolean; paidUp: string };

const amountOf = (text: string): bigint | null => {
  try {
    const v = parse(text);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
};

/** Loan officer: a new application with a live schedule preview (the server re-checks everything). */
export function ApplicationForm({ products, today }: { products: ProductOption[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [borrowerNo, setBorrowerNo] = useState("");
  const [borrower, setBorrower] = useState<Found | null>(null);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [purpose, setPurpose] = useState("");
  const [comakerNo, setComakerNo] = useState("");
  const [comakers, setComakers] = useState<Found[]>([]);
  const product = products.find((p) => p.id === productId);

  const preview = useMemo(() => {
    const principal = amountOf(amount);
    const n = Number(term);
    if (!product || principal === null || !Number.isInteger(n) || n < 1 || n > 360) return null;
    const rows = schedule({ principal, ratePm: product.ratePm, term: n, method: product.method, firstDueDate: addMonths(today, 1) });
    try {
      return { rows, totals: scheduleTotals(rows), deductions: netProceeds(principal, product.deductions) };
    } catch {
      return { rows, totals: scheduleTotals(rows), deductions: null };
    }
  }, [product, amount, term, today]);

  function find(memberNo: string, then: (m: Found) => void) {
    setError(null);
    startTransition(async () => {
      const r = await borrowerLookupAction({ memberNo });
      if (!r.ok) return setError(r.error);
      then(r.data);
    });
  }

  function submit() {
    setError(null);
    if (!borrower) return setError("Find the borrower first");
    startTransition(async () => {
      const r = await submitApplicationAction({ memberId: borrower.id, productId, amount, term: Number(term), purpose, comakerIds: comakers.map((c) => c.id) });
      if (!r.ok) return setError(r.error);
      router.push(`/loans/applications/${r.data.id}`);
    });
  }

  const describe = (m: Found) => `${m.name} (${m.memberNo ?? "no member no."}) · ${m.status}${m.goodStanding ? " · in good standing" : " · not in good standing"} · paid-up ${format(BigInt(m.paidUp))}`;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="borrowerNo">Borrower member no.</Label>
            <Input id="borrowerNo" value={borrowerNo} onChange={(e) => setBorrowerNo(e.target.value)} placeholder="M-000001" className="w-40" />
          </div>
          <Button type="button" variant="outline" disabled={pending} onClick={() => find(borrowerNo, setBorrower)}>
            Find borrower
          </Button>
        </div>
        {borrower ? <p className="text-sm">{describe(borrower)}</p> : null}
      </section>

      <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product">Product</Label>
          <select id="product" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="amount">Amount (₱)</Label>
          <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term">Term (months)</Label>
          <Input id="term" value={term} onChange={(e) => setTerm(e.target.value)} inputMode="numeric" placeholder={product ? `${product.minTerm}–${product.maxTerm}` : ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purpose">Purpose</Label>
          <Input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} />
        </div>
        {product ? (
          <p className="text-xs text-muted-foreground sm:col-span-4">
            {(Number(product.ratePm) * 100).toFixed(2).replace(/\.?0+$/, "")}% a month · {product.minTerm}–{product.maxTerm} months
            {product.maxAmount ? ` · up to ${format(BigInt(product.maxAmount))}` : ""}
            {product.maxMultipleOfPaidUp ? ` · up to ${product.maxMultipleOfPaidUp}× paid-up share capital` : ""}
            {` · ${product.requiredComakers} comaker${product.requiredComakers === 1 ? "" : "s"} needed`}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comakerNo">Comaker member no.</Label>
            <Input id="comakerNo" value={comakerNo} onChange={(e) => setComakerNo(e.target.value)} placeholder="M-000002" className="w-40" />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              find(comakerNo, (m) => {
                setComakers((cs) => (cs.some((c) => c.id === m.id) ? cs : [...cs, m]));
                setComakerNo("");
              })
            }
          >
            Add comaker
          </Button>
        </div>
        {comakers.length === 0 ? <p className="text-sm text-muted-foreground">No comakers.</p> : null}
        {comakers.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
            <span>{describe(c)}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setComakers((cs) => cs.filter((x) => x.id !== c.id))}>
              Remove
            </Button>
          </div>
        ))}
      </section>

      {preview ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Preview (first due date one month from today; the release sets the real dates)</h2>
          <div className="flex flex-wrap gap-6 text-sm">
            <p>
              Monthly payment <span className="font-semibold tabular-nums" data-testid="preview-payment">{format(preview.totals.regularPayment)}</span>
            </p>
            <p>Total interest {format(preview.totals.interest)}</p>
            {preview.deductions ? (
              <p>
                Deductions {format(preview.deductions.total)} · net proceeds <span className="font-semibold">{format(preview.deductions.net)}</span>
              </p>
            ) : (
              <p className="text-destructive">The deductions are more than the amount.</p>
            )}
          </div>
          <ScheduleTable rows={preview.rows} />
        </section>
      ) : null}

      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" onClick={submit} disabled={pending || !borrower}>
            Submit application
          </Button>
        </div>
        <Err error={error} />
      </div>
    </div>
  );
}

/** Manager / Credit Committee: approve or reject (remarks needed to reject). */
export function DecisionForm({ applicationId }: { applicationId: string }) {
  const { pending, error, done, run } = useAction();
  const [remarks, setRemarks] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-72 flex-1 flex-col gap-1.5">
          <Label htmlFor="remarks">Remarks</Label>
          <Input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} placeholder="Required to reject" />
        </div>
        <Button type="button" disabled={pending} onClick={() => run(() => decideApplicationAction({ applicationId, decision: "APPROVE", remarks }), { success: "Decision recorded." })}>
          Approve
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => decideApplicationAction({ applicationId, decision: "REJECT", remarks }), { success: "Rejected." })}>
          Reject
        </Button>
      </div>
      <Err error={error} />
      {done ? <p className="text-sm text-green-700 dark:text-green-400">{done}</p> : null}
    </div>
  );
}

/** The encoding loan officer withdraws the application. */
export function CancelApplicationForm({ applicationId }: { applicationId: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => cancelApplicationAction({ applicationId, reason: String(fd.get("cancelReason") ?? "") }))}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cancelReason">Reason for cancelling</Label>
        <Input id="cancelReason" name="cancelReason" required maxLength={300} className="w-64" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Cancel application
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

type DeductionRow = { code: string; name: string; basis: "PCT_OF_PRINCIPAL" | "FIXED"; value: string; glKey: string };
const GL_FOR: Record<string, string> = { SERVICE_FEE: "service_fee_income", CBU: "subscription_receivable_common", LPP: "lpp_insurance_payable", NOTARIAL: "notarial_fee_income", OTHER: "service_fee_income" };
const CODES = ["SERVICE_FEE", "CBU", "LPP", "NOTARIAL", "OTHER"] as const;

/** Admin: a loan product's terms and its deductions (percent and pesos as typed). */
export function LoanProductForm({
  product,
}: {
  product: { id: string; name: string; ratePct: string; minTerm: number; maxTerm: number; maxAmount: string; maxMultipleOfPaidUp: string; requiredComakers: number; penaltyPct: string; graceDays: number; isActive: boolean; deductions: DeductionRow[] };
}) {
  const { pending, error, done, run } = useAction();
  const [rows, setRows] = useState<DeductionRow[]>(product.deductions);
  const p = product;
  const set = (i: number, patch: Partial<DeductionRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <form
      className="flex flex-col gap-4"
      action={(fd) =>
        run(
          () =>
            updateLoanProductAction({
              productId: p.id,
              name: String(fd.get("name") ?? ""),
              ratePct: String(fd.get("ratePct") ?? ""),
              minTerm: Number(fd.get("minTerm") ?? 0),
              maxTerm: Number(fd.get("maxTerm") ?? 0),
              maxAmount: String(fd.get("maxAmount") ?? ""),
              maxMultipleOfPaidUp: String(fd.get("maxMultiple") ?? ""),
              requiredComakers: Number(fd.get("comakers") ?? 0),
              penaltyPct: String(fd.get("penaltyPct") ?? ""),
              graceDays: Number(fd.get("graceDays") ?? 0),
              isActive: fd.get("isActive") === "on",
              deductions: rows.map((r) => ({ ...r, code: r.code as (typeof CODES)[number] })),
            }),
          { success: "Saved." },
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["name", "Name", p.name],
          ["ratePct", "Interest (% a month)", p.ratePct],
          ["minTerm", "Shortest term (months)", String(p.minTerm)],
          ["maxTerm", "Longest term (months)", String(p.maxTerm)],
          ["maxAmount", "Maximum amount (₱, blank = none)", p.maxAmount],
          ["maxMultiple", "Up to × paid-up (blank = none)", p.maxMultipleOfPaidUp],
          ["comakers", "Comakers needed", String(p.requiredComakers)],
          ["penaltyPct", "Penalty (% a month, overdue)", p.penaltyPct],
          ["graceDays", "Grace days", String(p.graceDays)],
        ].map(([name, label, value]) => (
          <div key={name} className="flex flex-col gap-1.5">
            <Label htmlFor={`${name}-${p.id}`}>{label}</Label>
            <Input id={`${name}-${p.id}`} name={name} defaultValue={value} />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={p.isActive} /> Offered to members
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Deductions on release</p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <select aria-label="Deduction type" className={selectClass} value={r.code} onChange={(e) => set(i, { code: e.target.value, glKey: GL_FOR[e.target.value] ?? "service_fee_income" })}>
              {CODES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
            <Input aria-label="Deduction name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="w-48" />
            <select aria-label="Deduction basis" className={selectClass} value={r.basis} onChange={(e) => set(i, { basis: e.target.value as DeductionRow["basis"] })}>
              <option value="PCT_OF_PRINCIPAL">% of the loan</option>
              <option value="FIXED">fixed ₱</option>
            </select>
            <Input aria-label="Deduction value" value={r.value} onChange={(e) => set(i, { value: e.target.value })} className="w-28" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { code: "SERVICE_FEE", name: "Service fee", basis: "PCT_OF_PRINCIPAL", value: "1", glKey: "service_fee_income" }])}>
            Add deduction
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Err error={error} />
        {done ? <p className="text-sm text-green-700 dark:text-green-400">{done}</p> : null}
      </div>
    </form>
  );
}
