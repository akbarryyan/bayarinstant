/**
 * GET /api/home-content — public, returns game tags + FAQ
 */
import { NextResponse } from "next/server";
import { getHomeContent } from "@/lib/site-config";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

async function GET_handler() {
  const data = await getHomeContent();
  return NextResponse.json({ success: true, data });
}

export const GET = withRequestLog("/api/home-content", GET_handler);
