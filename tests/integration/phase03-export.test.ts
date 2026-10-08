import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { withTx } from "@/db/client";
import { generalLedgerWorkbook, trialBalanceWorkbook } from "@/modules/ledger/export";
import { postJournal } from "@/modules/ledger/service";
import { acct, P, seedLedger } from "../helpers/phase03";

beforeEach(seedLedger);

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf).buffer);
  const ws = wb.worksheets[0]!;
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("T3.5 Excel export", () => {
  it("trial balance and general ledger workbooks carry exact peso amounts and totals", async () => {
    const [cash, fee] = await Promise.all([acct("cash_on_hand"), acct("membership_fee_income")]);
    await withTx((tx) =>
      postJournal(
        tx,
        { date: "2026-10-07", book: "CRJ", particulars: "Fees", lines: [{ accountId: cash, debit: P(1234, 56) }, { accountId: fee, credit: P(1234, 56) }] },
        null,
      ),
    );
    const tb = await read(await trialBalanceWorkbook("2026-10-31", "PCMPC"));
    expect(tb[1]).toEqual(["Trial Balance"]);
    expect(tb.find((r) => r[0] === "11110")).toEqual(["11110", "Cash on Hand (provisional)", 1234.56]);
    expect(tb.find((r) => r[0] === "44110")).toEqual(["44110", "Membership Fee Income (provisional)", undefined, 1234.56]);
    expect(tb.at(-1)).toEqual(["", "TOTAL", 1234.56, 1234.56]);

    const gl = await read(await generalLedgerWorkbook(cash, "2026-10-01", "2026-10-31", "PCMPC"));
    expect(gl.at(-1)?.[2]).toBe("Closing balance");
    expect(gl.at(-1)?.[6]).toBe(1234.56);
  });
});
