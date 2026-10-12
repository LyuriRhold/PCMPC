import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";

export type ScheduleRowView = { no: number; dueDate: string; principal: bigint; interest: bigint; payment: bigint; balance: bigint };

/** A repayment schedule with totals (calculator, application, disclosure). */
export function ScheduleTable({ rows }: { rows: ScheduleRowView[] }) {
  const sum = (k: "principal" | "interest" | "payment") => rows.reduce((s, r) => s + r[k], 0n);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>No.</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead className="text-right">Principal</TableHead>
          <TableHead className="text-right">Interest</TableHead>
          <TableHead className="text-right">Payment</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.no}>
            <TableCell className="tabular-nums">{r.no}</TableCell>
            <TableCell className="tabular-nums">{formatDate(r.dueDate)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(r.principal)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(r.interest)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(r.payment)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(r.balance)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>Total</TableCell>
          <TableCell className="text-right tabular-nums">{format(sum("principal"))}</TableCell>
          <TableCell className="text-right tabular-nums">{format(sum("interest"))}</TableCell>
          <TableCell className="text-right tabular-nums">{format(sum("payment"))}</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export const METHOD_LABEL: Record<string, string> = {
  DIMINISHING_EQUAL_AMORT: "Diminishing balance, equal amortization",
  DIMINISHING_EQUAL_PRINCIPAL: "Diminishing balance, equal principal",
  ADD_ON: "Add-on (flat)",
};
