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
  // Everything except the login page, health check, auth API and static assets.
  matcher: ["/((?!login|health|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
