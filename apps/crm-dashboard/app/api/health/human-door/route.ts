import { NextResponse } from "next/server";
import {
  getHumanAuthorityReadiness,
  humanAuthorityReadinessMessage,
} from "@/lib/human-authority";

export async function GET() {
  const status = await getHumanAuthorityReadiness({ forceRefresh: true });

  if (status === "ready") {
    return NextResponse.json({ status: "ready" }, { status: 200 });
  }

  return NextResponse.json(
    { status, reason: humanAuthorityReadinessMessage(status) },
    { status: 503 },
  );
}
