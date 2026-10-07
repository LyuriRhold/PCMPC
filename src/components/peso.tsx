import { format, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Displays an amount as `₱1,234.56` (tabular digits, negatives in red).
 * Accepts bigint centavos, or centavos as a string when the value crossed a
 * server → client boundary (bigint is not serializable).
 */
export function Peso({ amount, className }: { amount: Money | string; className?: string }) {
  const value = typeof amount === "string" ? BigInt(amount) : amount;
  return (
    <span className={cn("tabular-nums", value < 0n && "text-destructive", className)}>{format(value)}</span>
  );
}
