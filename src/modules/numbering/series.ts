import { businessToday } from "@/lib/dates";
import { counterWidth } from "@/lib/numbering";
import type { Tx } from "@/db/client";
import { numberSeries } from "./schema";

/** Document number series from docs/DOMAIN.md §5 (formats are CONFIRM). */
export const NUMBER_SERIES: Array<{ code: string; format: string; resetsYearly: boolean }> = [
  { code: "MEMBER", format: "M-{000000}", resetsYearly: false },
  { code: "AR", format: "AR-{YYYY}-{000000}", resetsYearly: true },
  { code: "GJ", format: "GJ-{YYYY}-{00000}", resetsYearly: true },
  { code: "CRJ", format: "CRJ-{YYYY}-{00000}", resetsYearly: true },
  { code: "CDJ", format: "CDJ-{YYYY}-{00000}", resetsYearly: true },
  { code: "SJ", format: "SJ-{YYYY}-{00000}", resetsYearly: true },
  { code: "PJ", format: "PJ-{YYYY}-{00000}", resetsYearly: true },
  { code: "DV", format: "DV-{YYYY}-{00000}", resetsYearly: true },
  { code: "LA", format: "LA-{YYYY}-{00000}", resetsYearly: true },
  { code: "LN", format: "LN-{YYYY}-{00000}", resetsYearly: true },
  { code: "WC", format: "WC-{000000}", resetsYearly: false },
  { code: "WA", format: "WA-{000000}", resetsYearly: false },
  { code: "WAPP", format: "WAPP-{YYYY}-{00000}", resetsYearly: true },
  { code: "WB", format: "WB-{YYYYMM}-{000000}", resetsYearly: true },
  { code: "DN", format: "DN-{YYYY}-{00000}", resetsYearly: true },
  { code: "SA", format: "SA-{000000}", resetsYearly: false },
  { code: "TD", format: "TD-{000000}", resetsYearly: false },
  { code: "PO", format: "PO-{YYYY}-{00000}", resetsYearly: true },
  { code: "RR", format: "RR-{YYYY}-{00000}", resetsYearly: true },
  { code: "S", format: "S-{YYYY}-{000000}", resetsYearly: true },
];

/** Creates each series (the current business year's row for yearly series). Idempotent. */
export async function seedNumberSeries(tx: Tx): Promise<void> {
  const year = Number(businessToday().slice(0, 4));
  await tx
    .insert(numberSeries)
    .values(
      NUMBER_SERIES.map((s) => ({
        code: s.code,
        prefixFormat: s.format,
        year: s.resetsYearly ? year : 0,
        nextNo: 1,
        padding: counterWidth(s.format),
        resetsYearly: s.resetsYearly,
      })),
    )
    .onConflictDoNothing({ target: [numberSeries.code, numberSeries.year] });
}
