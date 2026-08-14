import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ProviderManagementService } from "@/src/core/services/provider/provider-management.service";
import { ProviderType } from "@/src/core/domain/enums/provider.enum";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/providers/[type]
 * Get specific provider info
 */
async function GET_handler(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const { type } = await params;
    const providerType = type.toUpperCase() as ProviderType;

    // Validate provider type
    if (!Object.values(ProviderType).includes(providerType)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid provider type",
          validTypes: Object.values(ProviderType),
        },
        { status: 400 }
      );
    }

    const service = new ProviderManagementService();
    const info = await service.getProviderInfo(providerType);

    return NextResponse.json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    log.error({ err: error }, "failed to get provider info");
    
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get provider info",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/providers/[type]", GET_handler);
