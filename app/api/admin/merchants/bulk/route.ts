import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  isActive: z.boolean(),
});

async function ensureAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId || session.role !== "ADMIN") {
    return null;
  }
  return session;
}

async function PATCH_handler(request: NextRequest) {
  try {
    const session = await ensureAdmin();
    if (!session) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const result = await prisma.sellerProfile.updateMany({
      where: { id: { in: parsed.data.ids } },
      data: { isActive: parsed.data.isActive },
    });

    return NextResponse.json({
      success: true,
      data: {
        count: result.count,
        isActive: parsed.data.isActive,
      },
    });
  } catch (error) {
    log.error({ err: error }, "request failed");
    return NextResponse.json({ success: false, error: "Gagal memperbarui merchant massal" }, { status: 500 });
  }
}

export const PATCH = withRequestLog("/api/admin/merchants/bulk", PATCH_handler);
