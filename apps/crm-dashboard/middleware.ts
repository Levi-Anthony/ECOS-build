import { NextRequest, NextResponse } from "next/server";

// Site-wide password gate (HTTP Basic Auth) for the ECOS dashboard.
// The dashboard renders private CRM / BRAIN / artifact data server-side, so the
// whole site must sit behind a credential. Vercel's platform-level Deployment
// Protection isn't available on the current plan, so we gate in-app instead.
//
// The password lives in the SITE_PASSWORD env var (server-only; set in Vercel +
// .env.local, never NEXT_PUBLIC). Username is ignored — any username + the
// correct password passes. Fail CLOSED: if SITE_PASSWORD is unset, deny (503)
// rather than risk serving data unprotected.

export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return new NextResponse("Site password not configured.", { status: 503 });
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    // atob is available in the Edge runtime.
    const decoded = atob(header.slice("Basic ".length));
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ECOS Dashboard"' },
  });
}

// Protect every route except Next internals and the favicon (static assets carry
// no data and no secrets — the data lives in the server-rendered page HTML, which
// IS matched here).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
