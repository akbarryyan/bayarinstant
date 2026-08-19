import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import { syncExpiredOrdersForUser } from "@/src/core/services/order/sync-expired-orders.service";
import { autoReconcileOrderNow } from "@/src/core/services/provider/reconcile-scheduler.service";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.orders");

// Status grup per tab
const TAB_STATUSES: Record<string, string[]> = {
  menunggu: ["CREATED", "WAITING_PAYMENT"],
  diproses: ["PAID", "PROCESSING_PROVIDER"],
  dikirim: [],          // digital product — no shipping; kept for UI parity
  selesai: ["SUCCESS"],
  dibatalkan: ["FAILED", "EXPIRED", "REFUNDED"],
};

async function GET_handler(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    await syncExpiredOrdersForUser(session.userId);

    const { searchParams } = req.nextUrl;
    const tab = searchParams.get("tab") ?? "menunggu";
    const q   = (searchParams.get("q") ?? "").trim();
    const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = 15;
    const skip  = (page - 1) * limit;

    // Build where clause.
    // NOTE: no `mode: "insensitive"` — MySQL's default collation is already
    // case-insensitive and the connector rejects that argument.
    const where: Prisma.OrderWhereInput = { userId: session.userId };

    if (q) {
      // Searching spans every status — a tab filter would hide the order the
      // user is looking for (guest lookup by code has no status filter either).
      where.OR = [
        { orderCode:    { contains: q } },
        { targetNumber: { contains: q } },
        { product: { name:  { contains: q } } },
        { product: { brand: { contains: q } } },
      ];
    } else {
      where.status = { in: TAB_STATUSES[tab] ?? [] };
    }

    let [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          status: true,
          amount: true,
          paymentMethod: true,
          targetNumber: true,
          serialNumber: true,
          createdAt: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              category: true,
            },
          },
        },
      }),
    ]);

    const reconcileCandidates = orders
      .filter((order) => order.status === "PAID" || order.status === "PROCESSING_PROVIDER")
      .slice(0, 5);

    if (reconcileCandidates.length > 0) {
      await Promise.allSettled(reconcileCandidates.map((order) => autoReconcileOrderNow(order.id)));
      orders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          status: true,
          amount: true,
          paymentMethod: true,
          targetNumber: true,
          serialNumber: true,
          createdAt: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              category: true,
            },
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: orders.map((o) => ({
        ...o,
        amount: Number(o.amount),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    log.error({ err: error }, "transaksi api failed");
    return NextResponse.json({ success: false, message: "Terjadi kesalahan" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/transaksi", GET_handler);
