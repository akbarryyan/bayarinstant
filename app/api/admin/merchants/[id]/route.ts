import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  isActive: z.boolean(),
});

async function ensureAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId || session.role !== "ADMIN") {
    return null;
  }
  return session;
}

async function PATCH_handler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await ensureAdmin();
    if (!session) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

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

    const merchant = await prisma.sellerProfile.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
      select: {
        id: true,
        isActive: true,
        displayName: true,
        slug: true,
      },
    });

    return NextResponse.json({ success: true, data: merchant });
  } catch (error) {
    log.error({ err: error }, "]");
    return NextResponse.json({ success: false, error: "Gagal memperbarui merchant" }, { status: 500 });
  }
}

export const PATCH = withRequestLog("/api/admin/merchants/[id]", PATCH_handler);
