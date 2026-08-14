import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 * Daftar user ringkas untuk keperluan admin (test transaksi, dll.)
 */
async function GET_handler() {
  const deny = await requireAdmin();
  if (deny) return deny;
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        tierId: true,
        tier: { select: { id: true, name: true, label: true, marginMultiplier: true } },
        wallet: { select: { balance: true } },
        _count: { select: { orders: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        tierId: u.tierId,
        tier: u.tier ? { ...u.tier, marginMultiplier: Number(u.tier.marginMultiplier) } : null,
        balance: u.wallet ? Number(u.wallet.balance) : 0,
        totalOrders: u._count.orders,
      })),
    });
  } catch (error) {
    log.error({ err: error }, "request failed");
    return NextResponse.json({ success: false, error: "Gagal mengambil data user" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/admin/users", GET_handler);
