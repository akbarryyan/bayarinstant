import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { ProviderRepository } from "@/src/infra/db/repositories/provider.repository";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

const providerRepo = new ProviderRepository();

/**
 * GET /api/admin/providers/settings
 * Get all provider settings (margin configuration)
 */
async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const settings = await providerRepo.getAllProviderSettings();

    // Convert Decimal to number for JSON serialization
    const serializedSettings = settings.map((setting) => ({
      ...setting,
      defaultMargin: Number(setting.defaultMargin),
      lastBalance: setting.lastBalance ? Number(setting.lastBalance) : null,
    }));

    return NextResponse.json({
      success: true,
      data: serializedSettings,
    });
  } catch (error: any) {
    log.error({ err: error }, "get settings error");
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to get provider settings" 
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/providers/settings
 * Update provider settings (margin configuration)
 * 
 * Body: {
 *   provider: string,
 *   defaultMargin: number,
 *   marginType: "FIXED" | "PERCENTAGE",
 *   isActive: boolean
 * }
 */
async function PUT_handler(request: NextRequest) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const body = await request.json();

    // Validate required fields
    if (!body.provider || body.defaultMargin === undefined || !body.marginType) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Missing required fields: provider, defaultMargin, marginType" 
        },
        { status: 400 }
      );
    }

    // Validate marginType
    if (!["FIXED", "PERCENTAGE"].includes(body.marginType)) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Invalid marginType. Must be FIXED or PERCENTAGE" 
        },
        { status: 400 }
      );
    }

    // Validate defaultMargin is a positive number
    if (typeof body.defaultMargin !== "number" || body.defaultMargin < 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: "defaultMargin must be a positive number" 
        },
        { status: 400 }
      );
    }

    const setting = await providerRepo.upsertProviderSetting({
      provider: body.provider,
      defaultMargin: body.defaultMargin,
      marginType: body.marginType,
      isActive: body.isActive !== undefined ? body.isActive : true,
    });

    // Convert Decimal to number for JSON serialization
    const serializedSetting = {
      ...setting,
      defaultMargin: Number(setting.defaultMargin),
      lastBalance: setting.lastBalance ? Number(setting.lastBalance) : null,
    };

    return NextResponse.json({
      success: true,
      data: serializedSetting,
    });
  } catch (error: any) {
    log.error({ err: error }, "update settings error");
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to update provider settings" 
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/providers/settings", GET_handler);
export const PUT = withRequestLog("/api/admin/providers/settings", PUT_handler);
