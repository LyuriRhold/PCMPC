import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { members } from "@/modules/members/schema";
import { MEMBER_SUBSIDIARY_KEYS } from "@/modules/ledger/provisional-coa";
import { listAccounts } from "@/modules/ledger/coa-admin";
import { BOOKS } from "@/modules/ledger/schema";
import { generalLedger, journalBook, subsidiaryLedger, trialBalance, type LedgerLine } from "@/modules/ledger/service";

export const metadata: Metadata = { title: "Ledger & trial balance · PCMPC MIS" };

const VIEWS = [
  { id: "tb", label: "Trial balance" },
  { id: "gl", label: "General ledger" },
  { id: "books", label: "Journal books" },
  { id: "sub", label: "Member subsidiary ledger" },
] as const;

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const date = one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined));
const schema = z.object({
  view: one.pipe(z.enum(["tb", "gl", "books", "sub"]).optional().catch(undefined)),
  asOf: date,
  from: date,
  to: date,
  account: one.pipe(z.uuid().optional().catch(undefined)),
  book: one.pipe(z.enum(BOOKS).optional().catch(undefined)),
  key: one.pipe(z.enum(MEMBER_SUBSIDIARY_KEYS).optional().catch(undefined)),
  member: one,
});

const money = (m: Money) => (m ? format(m) : "");

function LedgerTable({ opening, lines, closing, from, to, showMember }: { opening: Money; lines: LedgerLine[]; closing: Money; from: string; to: string; showMember: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>JE no.</TableHead>
          <TableHead>Particulars</TableHead>
          {showMember ? <TableHead>Member</TableHead> : null}
          <TableHead className="text-right">Debit</TableHead>
          <TableHead className="text-right">Credit</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="tabular-nums">{formatDate(from)}</TableCell>
          <TableCell />
          <TableCell className="font-medium">Opening balance</TableCell>
          {showMember ? <TableCell /> : null}
          <TableCell />
          <TableCell />
          <TableCell className="text-right tabular-nums">{format(opening)}</TableCell>
        </TableRow>
        {lines.map((l, i) => (
          <TableRow key={`${l.jeId}-${i}`}>
            <TableCell className="whitespace-nowrap tabular-nums">{formatDate(l.date)}</TableCell>
            <TableCell className="font-mono text-xs">
              <Link href={`/accounting/journals/${l.jeId}`} className="hover:underline">
                {l.jeNo}
              </Link>
            </TableCell>
            <TableCell>{l.particulars}</TableCell>
            {showMember ? <TableCell className="text-xs">{l.memberNo ?? ""}</TableCell> : null}
            <TableCell className="text-right tabular-nums">{money(l.debit)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(l.credit)}</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="running">
              {format(l.running)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={showMember ? 6 : 5}>Closing balance, {formatDate(to)}</TableCell>
          <TableCell className="text-right tabular-nums">{format(closing)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

async function LedgerContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = schema.parse(await searchParams);
  const view = f.view ?? "tb";
  const today = businessToday();
  const from = f.from ?? `${today.slice(0, 8)}01`;
  const to = f.to ?? today;
  const asOf = f.asOf ?? today;

  let body: React.ReactNode = null;
  if (view === "tb") {
    const tb = await trialBalance(asOf);
    body = (
      <div className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="tb" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asOf">As of</Label>
            <Input id="asOf" name="asOf" type="date" defaultValue={asOf} className="w-40" />
          </div>
          <Button type="submit" size="sm">
            Show
          </Button>
          <a className="text-sm underline underline-offset-4" href={`/api/reports/trial-balance?asOf=${asOf}`}>
            Download Excel
          </a>
          <span
            data-testid="tb-status"
            className={cn("text-sm font-medium", tb.balanced ? "text-green-700" : "text-destructive")}
          >
            {tb.balanced ? "Balanced" : "Out of balance"}
          </span>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tb.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No postings up to {formatDate(asOf)}.
                </TableCell>
              </TableRow>
            ) : null}
            {tb.rows.map((r) => (
              <TableRow key={r.accountId}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell>
                  <Link className="hover:underline" href={`/accounting/ledger?view=gl&account=${r.accountId}&from=${asOf.slice(0, 4)}-01-01&to=${asOf}`}>
                    {r.name}
                  </Link>
                  {r.provisional ? (
                    <Badge variant="secondary" className="ml-2">
                      Provisional
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.debit)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.credit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right tabular-nums">{format(tb.totalDebit)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(tb.totalCredit)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    );
  } else if (view === "gl") {
    const accounts = (await listAccounts()).filter((a) => a.isPostable);
    const gl = f.account ? await generalLedger(f.account, from, to) : null;
    body = (
      <div className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="gl" />
          <div className="flex min-w-72 flex-col gap-1.5">
            <Label htmlFor="account">Account</Label>
            <select id="account" name="account" defaultValue={f.account ?? ""} className={selectClass}>
              <option value="">Choose an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                  {a.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" size="sm">
            Show
          </Button>
          {gl ? (
            <a className="text-sm underline underline-offset-4" href={`/api/reports/general-ledger?account=${f.account}&from=${from}&to=${to}`}>
              Download Excel
            </a>
          ) : null}
        </form>
        {gl ? (
          <>
            <p className="text-sm text-muted-foreground">
              {gl.account.code} {gl.account.name} · normal balance {gl.side}
            </p>
            <LedgerTable opening={gl.opening} lines={gl.lines} closing={gl.closing} from={from} to={to} showMember />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Choose an account to see its ledger.</p>
        )}
      </div>
    );
  } else if (view === "books") {
    const book = f.book ?? "GJ";
    const entries = await journalBook(book, from, to);
    body = (
      <div className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="books" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="book">Book</Label>
            <select id="book" name="book" defaultValue={book} className={selectClass}>
              {BOOKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" size="sm">
            Show
          </Button>
        </form>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">No posted entries in this book and period.</p> : null}
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border">
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-3 py-2 text-sm">
              <Link href={`/accounting/journals/${e.id}`} className="font-mono text-xs hover:underline">
                {e.jeNo}
              </Link>
              <span className="tabular-nums">{formatDate(e.entryDate)}</span>
              <span className="flex-1">{e.particulars}</span>
              {e.status === "REVERSED" ? <Badge variant="outline">REVERSED</Badge> : null}
            </div>
            <Table>
              <TableBody>
                {e.lines.map((l) => (
                  <TableRow key={l.lineNo}>
                    <TableCell className={cn("w-1/2", l.credit ? "pl-10" : "")}>
                      <span className="font-mono text-xs">{l.code}</span> {l.name}
                      {l.memberNo ? <span className="ml-2 text-xs text-muted-foreground">{l.memberNo}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.debit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.credit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    );
  } else {
    const key = f.key ?? "savings_deposits";
    const memberNo = f.member?.trim().toUpperCase() ?? "";
    const [member] = memberNo ? await getDb().select().from(members).where(eq(members.memberNo, memberNo)) : [];
    const sub = member ? await subsidiaryLedger(key, member.id, from, to) : null;
    body = (
      <div className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="sub" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key">Ledger</Label>
            <select id="key" name="key" defaultValue={key} className={selectClass}>
              {MEMBER_SUBSIDIARY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member">Member no.</Label>
            <Input id="member" name="member" defaultValue={memberNo} placeholder="M-000001" className="w-36" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" size="sm">
            Show
          </Button>
        </form>
        {memberNo && !member ? <p className="text-sm text-destructive">Member {memberNo} not found.</p> : null}
        {sub && member ? (
          <>
            <p className="text-sm text-muted-foreground">
              {member.memberNo} · {member.lastName}, {member.firstName} · {sub.account.code} {sub.account.name} · balance{" "}
              <span className="font-medium text-foreground">
                {format(sub.closing)} {sub.side === "CR" ? "Cr" : "Dr"}
              </span>
            </p>
            <LedgerTable opening={sub.opening} lines={sub.lines} closing={sub.closing} from={from} to={to} showMember={false} />
          </>
        ) : !memberNo ? (
          <p className="text-sm text-muted-foreground">Enter a member number.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Ledger &amp; trial balance</h1>
        <p className="text-sm text-muted-foreground">Posted entries only. Drafts are not in the books.</p>
      </div>
      <nav aria-label="Ledger reports" className="flex flex-wrap gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`/accounting/ledger?view=${v.id}`}
            aria-current={view === v.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              view === v.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

export default function LedgerPage(props: PageProps<"/accounting/ledger">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <LedgerContent searchParams={props.searchParams} />
    </Suspense>
  );
}
