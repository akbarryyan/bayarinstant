import { NextResponse } from "next/server";
import { isPoppayConfigured, PoppayClient } from "@/src/infra/payment/poppay/poppay.client";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

async function GET_handler(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    if (!(await isPoppayConfigured())) {
      return NextResponse.json(
        {
          success: false,
          error: "Poppay belum terkonfigurasi di environment/database.",
        },
        { status: 400 }
      );
    }

    const { uid } = await params;
    const client = new PoppayClient();
    const data = await client.inquireIncoming(uid);

    return NextResponse.json({
      success: true,
      gateway: "POPPAY",
      data,
      note:
        data.status === "unknown"
          ? "Respons inquiry Poppay belum cukup jelas untuk dipetakan ke status internal. Perlu contoh respons real saat paid/pending."
          : undefined,
    });
  } catch (error) {
    log.error({ err: error }, "poppay inquiry failed");
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Gagal inquiry transaksi Poppay.",
      },
      { status: 502 }
    );
  }
}

export const GET = withRequestLog("/api/admin/payment-gateway/poppay/inquiry/[uid]", GET_handler);
