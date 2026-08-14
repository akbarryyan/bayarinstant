/**
 * GET /api/orders?page=1&limit=10
 *
 * Returns paginated orders for the currently logged-in user.
 * Guests cannot use this endpoint (use /api/orders/[code]?token=... for single order).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { getSession } from "@/lib/session";
import { syncExpiredOrdersForUser } from "@/src/core/services/order/sync-expired-orders.service";
import { autoReconcileOrderNow } from "@/src/core/services/provider/reconcile-scheduler.service";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.orders");

export const dynamic = "force-dynamic";

async function GET_handler(request: Request) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    await syncExpiredOrdersForUser(session.userId);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10)));
    const skip = (page - 1) * limit;

    let [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          status: true,
          amount: true,
          fee: true,
          paymentMethod: true,
          notes: true,
          serialNumber: true,
          createdAt: true,
          updatedAt: true,
          product: {
            select: { name: true, brand: true, category: true },
          },
          paymentInvoice: {
            select: { status: true, method: true, paymentUrl: true, expiredAt: true, paidAt: true },
          },
        },
      }),
      prisma.order.count({ where: { userId: session.userId } }),
    ]);

    const reconcileCandidates = orders
      .filter((order) => order.status === "PAID" || order.status === "PROCESSING_PROVIDER")
      .slice(0, 5);

    if (reconcileCandidates.length > 0) {
      await Promise.allSettled(reconcileCandidates.map((order) => autoReconcileOrderNow(order.id)));
      orders = await prisma.order.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          status: true,
          amount: true,
          fee: true,
          paymentMethod: true,
          notes: true,
          serialNumber: true,
          createdAt: true,
          updatedAt: true,
          product: {
            select: { name: true, brand: true, category: true },
          },
          paymentInvoice: {
            select: { status: true, method: true, paymentUrl: true, expiredAt: true, paidAt: true },
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: orders.map((o) => ({
        orderCode: o.orderCode,
        status: o.status,
        amount: Number(o.amount),
        fee: Number(o.fee),
        paymentMethod: o.paymentMethod,
        notes: o.notes ?? null,
        serialNumber: o.serialNumber ?? null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        product: o.product,
        paymentInvoice: o.paymentInvoice,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    log.error({ err }, "request failed");
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/orders", GET_handler);
