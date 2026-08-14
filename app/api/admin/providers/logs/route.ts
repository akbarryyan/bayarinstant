import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ProviderManagementService } from "@/src/core/services/provider/provider-management.service";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/providers/logs
 * Get provider operation logs
 */
async function GET_handler(request: Request) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || undefined;
    const action = searchParams.get("action") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const service = new ProviderManagementService();
    const logs = await service.getProviderLogs({
      provider,
      action,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      data: logs,
      meta: {
        limit,
        offset,
        count: logs.length,
      },
    });
  } catch (error) {
    log.error({ err: error }, "failed to get provider logs");
    
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get provider logs",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/providers/logs", GET_handler);
