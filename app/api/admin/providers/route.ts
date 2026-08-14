import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ProviderManagementService } from "@/src/core/services/provider/provider-management.service";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/providers
 * Get all providers info (balance, health, mode)
 */
async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const service = new ProviderManagementService();
    const providersInfo = await service.getAllProvidersInfo();

    return NextResponse.json({
      success: true,
      data: providersInfo.map((info) => ({
        type: info.type,
        mode: info.mode,
        balance: {
          amount: info.balance.balance,
          currency: info.balance.currency,
          lastUpdated: info.balance.lastUpdated,
        },
        health: {
          status: info.health.status,
          latency: info.health.latency,
          lastCheck: info.health.lastCheck,
          message: info.health.message,
        },
      })),
    });
  } catch (error) {
    log.error({ err: error }, "failed to get providers info");
    
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get providers info",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/providers", GET_handler);
