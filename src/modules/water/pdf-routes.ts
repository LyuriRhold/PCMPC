import { ForbiddenError, getCurrentUser, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import type { Permission } from "@/modules/auth/permissions";
import { getSetting } from "@/modules/settings/service";
import { billDetail, periodBills, periodGrid, type BillDetail } from "./billing-queries";
import { noticeData } from "./collections";
import { billsPdf, noticePdf, readingSheetPdf } from "./pdf";

/** Shared logic of the PDF route handlers (src/app/api/water/...). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Allows the request when the user has any of `permissions`; otherwise returns the error response. */
export async function guard(permissions: Permission[]): Promise<Response | null> {
  try {
    const user = await getCurrentUser();
    await requirePermission(permissions.find((p) => user?.permissions.has(p)) ?? permissions[0]!);
    return null;
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}

function pdf(body: Buffer, filename: string): Response {
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" },
  });
}

export async function readingSheetResponse(periodId: string, routeId: string | null): Promise<Response> {
  if (!UUID.test(periodId) || (routeId !== null && !UUID.test(routeId))) return new Response("Not found", { status: 404 });
  const grid = await periodGrid(periodId);
  const route = grid?.routes.find((r) => r.id === routeId) ?? (routeId === null ? grid?.routes[0] : undefined);
  if (!grid || !route) return new Response("Not found", { status: 404 });
  const body = await readingSheetPdf({
    coopName: await getSetting("coop.name"),
    period: grid.period.period,
    zone: grid.period.zone.code,
    route: { code: route.code, name: route.name },
    readingFrom: grid.period.readingFrom,
    readingTo: grid.period.readingTo,
    rows: route.rows,
  });
  return pdf(body, `reading-sheet-${grid.period.period}-${route.code}.pdf`);
}

export async function billsResponse(periodId: string, routeId: string | null): Promise<Response> {
  if (!UUID.test(periodId) || (routeId !== null && !UUID.test(routeId))) return new Response("Not found", { status: 404 });
  const bills = (await periodBills(periodId)).filter((b) => routeId === null || b.routeId === routeId);
  if (bills.length === 0) return new Response("No bills", { status: 404 });
  const details = (await Promise.all(bills.map((b) => billDetail(b.id)))).filter((d): d is BillDetail => !!d);
  const period = details[0]!.period.period;
  const body = await billsPdf(details, await getSetting("coop.name"), `Water bills ${period}`, await getSetting("water.bill_paper"));
  return pdf(body, `water-bills-${period}${routeId ? `-${details[0]!.route.code}` : ""}.pdf`);
}

export async function billResponse(billId: string): Promise<Response> {
  if (!UUID.test(billId)) return new Response("Not found", { status: 404 });
  const d = await billDetail(billId);
  if (!d) return new Response("Not found", { status: 404 });
  return pdf(await billsPdf([d], await getSetting("coop.name"), `Water bill ${d.bill.billNo}`, await getSetting("water.bill_paper")), `${d.bill.billNo}.pdf`);
}

export async function noticeResponse(id: string): Promise<Response> {
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const d = await noticeData(id);
  if (!d) return new Response("Not found", { status: 404 });
  return pdf(await noticePdf({ coopName: await getSetting("coop.name"), ...d }), `${d.noticeNo}.pdf`);
}
