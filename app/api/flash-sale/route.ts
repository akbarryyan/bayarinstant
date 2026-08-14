/**
 * GET /api/flash-sale
 * Public endpoint — returns flash sale config for the home page.
 */

import { NextResponse } from "next/server";
import { getFlashSaleConfig } from "@/lib/site-config";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

async function GET_handler() {
  const config = await getFlashSaleConfig();
  return NextResponse.json({ success: true, data: config });
}

export const GET = withRequestLog("/api/flash-sale", GET_handler);
