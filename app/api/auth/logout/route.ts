import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.auth");

async function POST_handler() {
  try {
    const session = await getSession();
    session.destroy();

    return NextResponse.json({
      success: true,
      message: "Berhasil logout.",
    });
  } catch (error) {
    log.error({ err: error }, "auth logout failed");
    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan. Coba lagi." },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog("/api/auth/logout", POST_handler);
