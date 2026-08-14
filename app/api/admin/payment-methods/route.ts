import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

const DEFAULT_METHODS = [
  { key: "qris", label: "QRIS", group: "QRIS", imageUrl: null, sortOrder: 1 },
];

/**
 * GET /api/admin/payment-methods
 * Returns ALL payment methods (active + inactive), seeding current defaults if empty.
 */
async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    const count = await prisma.paymentMethod.count();
    if (count === 0) {
      await prisma.paymentMethod.createMany({
        data: DEFAULT_METHODS.map((m) => ({ ...m, isActive: true })),
        skipDuplicates: true,
      });
    }

    const methods = await prisma.paymentMethod.findMany({
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ success: true, data: methods });
  } catch (error) {
    log.error({ err: error }, "admin payment methods get failed");
    return NextResponse.json({ success: false, error: "Gagal memuat data." }, { status: 500 });
  }
}

/**
 * POST /api/admin/payment-methods
 * Create a new payment method.
 * Body: { key, label, group, imageUrl?, sortOrder? }
 */
async function POST_handler(req: NextRequest) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;
    const { key, label, group, imageUrl, sortOrder } = await req.json();
    if (!key || !label || !group) {
      return NextResponse.json({ success: false, error: "key, label, dan group wajib diisi." }, { status: 400 });
    }

    const existing = await prisma.paymentMethod.findUnique({ where: { key } });
    if (existing) {
      return NextResponse.json({ success: false, error: "Key sudah digunakan." }, { status: 409 });
    }

    const method = await prisma.paymentMethod.create({
      data: { key, label, group, imageUrl: imageUrl || null, sortOrder: sortOrder ?? 99, isActive: true },
    });

    return NextResponse.json({ success: true, data: method });
  } catch (error) {
    log.error({ err: error }, "admin payment methods post failed");
    return NextResponse.json({ success: false, error: "Gagal membuat metode pembayaran." }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/admin/payment-methods", GET_handler);
export const POST = withRequestLog("/api/admin/payment-methods", POST_handler);
