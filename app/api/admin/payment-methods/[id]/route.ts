import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/payment-methods/[id]
 * Update label, group, imageUrl, isActive, sortOrder
 */
async function PATCH_handler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    const { id } = await params;
    const body = await req.json();

    const allowed = ["label", "group", "imageUrl", "isActive", "sortOrder"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    for (const k of allowed) {
      if (k in body) data[k] = body[k];
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: "Tidak ada field yang diubah." }, { status: 400 });
    }

    const method = await prisma.paymentMethod.update({ where: { id }, data });
    return NextResponse.json({ success: true, data: method });
  } catch (error) {
    log.error({ err: error }, "admin payment methods patch failed");
    return NextResponse.json({ success: false, error: "Gagal memperbarui." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/payment-methods/[id]
 * Delete a payment method permanently.
 */
async function DELETE_handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    const { id } = await params;
    await prisma.paymentMethod.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error({ err: error }, "admin payment methods delete failed");
    return NextResponse.json({ success: false, error: "Gagal menghapus." }, { status: 500 });
  }
}

export const PATCH = withRequestLog("/api/admin/payment-methods/[id]", PATCH_handler);
export const DELETE = withRequestLog("/api/admin/payment-methods/[id]", DELETE_handler);
