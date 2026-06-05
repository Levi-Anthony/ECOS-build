import { NextRequest, NextResponse } from "next/server";
import { hasBasicAuthPassword } from "@/lib/basic-auth";
import { getHumanAuthorityReadiness } from "@/lib/human-authority";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { status: "missing_configuration" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!hasBasicAuthPassword(request.headers.get("authorization"), password)) {
    return NextResponse.json(
      { status: "authentication_required" },
      {
        status: 401,
        headers: {
          ...NO_STORE_HEADERS,
          "WWW-Authenticate": 'Basic realm="ECOS Human Door Health"',
        },
      },
    );
  }

  const status = await getHumanAuthorityReadiness({ forceRefresh: true });
  return NextResponse.json(
    { status },
    { status: status === "ready" ? 200 : 503, headers: NO_STORE_HEADERS },
  );
}
