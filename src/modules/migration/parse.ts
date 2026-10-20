import ExcelJS from "exceljs";
import { TEMPLATES, type MigrationEntity } from "./templates";

/**
 * Reads an uploaded template (PHASE-17 T17.3): the data sheet's header row must be the template's
 * headers in order; each non-empty row below becomes text cells keyed by header. Excel's typed
 * values are turned into text the way a person would type them (dates as YYYY-MM-DD).
 */

export type RowError = { row: number; column: string; message: string };
export type RawRow = { rowNo: number; cells: Record<string, string> };

const pad = (n: number) => String(n).padStart(2, "0");

/** A cell's value as typed text ("" when blank). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  // Excel dates have no time zone: ExcelJS gives them as UTC midnight.
  if (value instanceof Date) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
  if ("formula" in value || "sharedFormula" in value) return cellText((value as ExcelJS.CellFormulaValue).result ?? null);
  if ("hyperlink" in value) return cellText(value.text);
  if ("error" in value) return String(value.error);
  return "";
}

/** The rows of an uploaded file, or the problems that keep it from being read at all. */
export async function readSheet(entity: MigrationEntity, content: Uint8Array): Promise<{ rows: RawRow[]; errors: RowError[] }> {
  const def = TEMPLATES[entity];
  const headers = def.columns.map((c) => c.header);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(new Uint8Array(content).buffer);
  } catch {
    return { rows: [], errors: [{ row: 1, column: "(file)", message: "This isn't an Excel (.xlsx) file; use the downloaded template" }] };
  }
  const ws = wb.getWorksheet(def.sheet);
  if (!ws) return { rows: [], errors: [{ row: 1, column: "(file)", message: `The file has no "${def.sheet}" sheet; use the ${def.title} template` }] };

  const found = headers.map((_h, i) => cellText(ws.getRow(1).getCell(i + 1).value));
  const extra = cellText(ws.getRow(1).getCell(headers.length + 1).value);
  if (found.some((h, i) => h !== headers[i]) || extra) {
    return { rows: [], errors: [{ row: 1, column: "(headers)", message: `The headers must be the template's, in order: ${headers.join(" | ")}` }] };
  }

  const rows: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => (cells[h] = cellText(row.getCell(i + 1).value)));
    if (Object.values(cells).some((v) => v !== "")) rows.push({ rowNo: r, cells });
  }
  return { rows, errors: [] };
}
