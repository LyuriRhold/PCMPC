import ExcelJS from "exceljs";
import { formatDate } from "@/lib/dates";
import { getSetting } from "@/modules/settings/service";
import { guard } from "@/modules/water/pdf-routes";
import { reportDef, reportParams, type Cell, type Kind } from "@/modules/water/report-tables";
import { WATER_REPORT_VIEWERS } from "@/modules/water/ui/report-access";

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Excel cells hold numbers (pesos), dates as text, percentages as numbers. */
function cell(v: Cell, kind: Kind): string | number | null {
  if (v === null || v === "") return null;
  if (kind === "money" && typeof v === "bigint") {
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const pesos = Number(abs / 100n) + Number(abs % 100n) / 100;
    return neg ? -pesos : pesos;
  }
  if (kind === "pct") return v === null ? null : Number(v);
  if (kind === "date" && typeof v === "string") return formatDate(v);
  return typeof v === "bigint" ? Number(v) : v;
}

/** GET /api/water/reports/{key}?period=…&month=…&date=…&asOf=…&from=…&to=…&customer=… → .xlsx */
export async function GET(request: Request, ctx: RouteContext<"/api/water/reports/[key]">) {
  const denied = await guard(WATER_REPORT_VIEWERS);
  if (denied) return denied;
  const { key } = await ctx.params;
  const def = reportDef(key);
  if (!def) return new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const params = reportParams((k) => q.get(k));
  if (def.params.includes("customer") && !UUID.test(params.customer)) return new Response("Choose a customer", { status: 400 });
  const table = await def.build(params);

  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet(table.title.slice(0, 31));
  ws.addRow([await getSetting("coop.name")]).font = { bold: true, size: 12 };
  ws.addRow([table.title]).font = { bold: true };
  ws.addRow([table.subtitle]);
  ws.addRow([]);
  ws.addRow(table.columns.map((c) => c.label)).font = { bold: true };
  for (const r of table.rows) ws.addRow(table.columns.map((c) => cell(r[c.key] ?? null, c.kind)));
  if (table.footer) ws.addRow(table.columns.map((c) => cell(table.footer?.[c.key] ?? null, c.kind))).font = { bold: true };
  table.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.kind === "text" ? 28 : 16;
    if (c.kind === "money") col.numFmt = PESO;
    if (c.kind === "pct") col.numFmt = '0.00"%"';
  });
  const body = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(body as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="water-${key}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
