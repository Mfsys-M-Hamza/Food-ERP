import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Coarse gate only: staff areas require a session cookie, otherwise redirect
 * to the staff login. Real authentication and authorisation happen on the
 * server for every page, action and API call.
 */
export function proxy(request: NextRequest) {
  const hasSession = !!getSessionCookie(request, { cookiePrefix: "ferp" });
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff/login";
    url.search = "";
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*", "/kitchen/:path*", "/rider/:path*", "/display/:path*", "/print/:path*", "/staff"],
};
