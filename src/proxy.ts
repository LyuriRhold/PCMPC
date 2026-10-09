import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect: no session cookie → /login. This is only a convenience; every protected
 * page and action still checks the session and permissions on the server.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const target = request.nextUrl.pathname + request.nextUrl.search;
  if (target !== "/") url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, health check, auth API, cron (checks CRON_SECRET), static assets and the reading
  // app's service worker, manifest and icon (fetched by the browser without a page).
  matcher: ["/((?!login|health|api/auth|api/cron|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|reader-icon.svg).*)"],
};
