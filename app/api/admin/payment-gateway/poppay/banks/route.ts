import { NextRequest, NextResponse } from "next/server";
import { isPoppayConfigured, PoppayClient } from "@/src/infra/payment/poppay/poppay.client";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

async function GET_handler(request: NextRequest) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    if (!(await isPoppayConfigured())) {
      return NextResponse.json(
        {
          success: false,
          error: "Poppay belum terkonfigurasi di environment.",
          requiredEnv: [
            "POPPAY_API_BASE_URL atau POPPAY_URL + POPPAY_PORT",
            "POPPAY_VERSION",
            "POPPAY_INTEGRATOR_TOKEN",
          ],
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const start = Number(searchParams.get("start") ?? "0");
    const length = Number(searchParams.get("length") ?? "50");
    const currency = (searchParams.get("currency") ?? "IDR").trim();

    const client = new PoppayClient();
    const data = await client.listBanks({
      start: Number.isFinite(start) ? start : 0,
      length: Number.isFinite(length) ? length : 50,
      filters: currency ? [{ key: "c", value: currency }] : undefined,
    });

    return NextResponse.json({
      success: true,
      gateway: "POPPAY",
      data,
    });
  } catch (error) {
    log.error({ err: error }, "poppay bank list failed");
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Gagal mengambil bank list dari Poppay.",
      },
      { status: 502 }
    );
  }
}

export const GET = withRequestLog("/api/admin/payment-gateway/poppay/banks", GET_handler);
