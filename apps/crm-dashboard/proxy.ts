import { NextRequest, NextResponse } from "next/server";
import { hasBasicAuthPassword } from "@/lib/basic-auth";

// Site-wide password gate (HTTP Basic Auth) for the ECOS dashboard.
// The dashboard renders private CRM / BRAIN / artifact data server-side, so the
// whole site must sit behind a credential. Vercel's platform-level Deployment
// Protection isn't available on the current plan, so we gate in-app instead.
//
// The password lives in the SITE_PASSWORD env var (server-only; set in Vercel +
// .env.local, never NEXT_PUBLIC). Username is ignored — any username + the
// correct password passes. Fail CLOSED: if SITE_PASSWORD is unset, deny (503)
// rather than risk serving data unprotected.

export function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const healthRequest = req.nextUrl.pathname === "/api/health/human-door";
  const response = (body: string, status: number, headers: Record<string, string> = {}) => new NextResponse(body, {
    status,
    headers: healthRequest ? { ...headers, "Cache-Control": "no-store" } : headers,
  });

  if (!password) {
    if (healthRequest) {
      return response(JSON.stringify({ status: "missing_configuration" }), 503, {
        "Content-Type": "application/json",
      });
    }
    return response("Site password not configured.", 503);
  }

  const header = req.headers.get("authorization");
  if (hasBasicAuthPassword(header, password)) {
    const next = NextResponse.next();
    if (healthRequest) next.headers.set("Cache-Control", "no-store");
    return next;
  }

  return response("Authentication required.", 401, {
    "WWW-Authenticate": 'Basic realm="ECOS Dashboard"',
  });
}

// Protect every route except Next internals and the favicon (static assets carry
// no data and no secrets — the data lives in the server-rendered page HTML, which
// IS matched here).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
