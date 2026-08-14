import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ProviderManagementService } from "@/src/core/services/provider/provider-management.service";
import { ProviderType } from "@/src/core/domain/enums/provider.enum";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

const providerService = new ProviderManagementService();

/**
 * POST /api/admin/providers/[type]/check-balance
 * On-demand balance check for specific provider
 */
async function POST_handler(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const { type } = await params;
    const provider = type.toUpperCase() as ProviderType;

    // Validate provider
    if (!Object.values(ProviderType).includes(provider)) {
      return NextResponse.json(
        { success: false, error: "Invalid provider type" },
        { status: 400 }
      );
    }

    // Check balance
    const result = await providerService.checkProviderBalance(provider);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    log.error({ err: error }, "check balance error");
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to check balance" 
      },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog("/api/admin/providers/[type]/check-balance", POST_handler);
