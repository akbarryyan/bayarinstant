/**
 * GET /api/orders/[code]?token=<viewToken>
 *
 * Supports:
 * - owner/admin access via session
 * - legacy guest deep-link access via token
 * - public code lookup without login/token
 *
 * Rule: No business logic — parse/validate/query/respond.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { getSession } from "@/lib/session";
import { syncExpiredOrderByCode } from "@/src/core/services/order/sync-expired-orders.service";
import { autoReconcileOrderNow } from "@/src/core/services/provider/reconcile-scheduler.service";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.orders");

export const dynamic = "force-dynamic";

const orderRepo = new OrderRepository();

async function GET_handler(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const rawToken = searchParams.get("token");

    await syncExpiredOrderByCode(code);

    // ── Fetch order ────────────────────────────────────────────────────────
    let order = await orderRepo.findByCode(code);

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // ── Access control ─────────────────────────────────────────────────────
    const session = await getSession();
    const sessionUserId = session.isLoggedIn ? session.userId : null;

    if (order.userId) {
      const isOwnerOrAdmin = session.role === "ADMIN" || sessionUserId === order.userId;
      if (!isOwnerOrAdmin && rawToken) {
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        if (!order.viewTokenHash || order.viewTokenHash !== tokenHash) {
          return NextResponse.json({ success: false, error: "Invalid token" }, { status: 403 });
        }
      }
    } else if (rawToken) {
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      if (!order.viewTokenHash || order.viewTokenHash !== tokenHash) {
        return NextResponse.json({ success: false, error: "Invalid token" }, { status: 403 });
      }
    }

    if (order.status === "PAID" || order.status === "PROCESSING_PROVIDER") {
      const reconciled = await autoReconcileOrderNow(order.id);
      if (reconciled) {
        order = reconciled;
      }
    }

    // ── Shape response (minimal — no internal fields) ──────────────────────
    return NextResponse.json({
      success: true,
      data: {
        orderCode: order.orderCode,
        status: order.status,
        product: {
          name: order.product.name,
          category: order.product.category,
          brand: order.product.brand,
        },
        targetNumber: order.targetNumber,
        targetData: order.targetData,
        notes: order.notes ?? null,
        amount: Number(order.amount),
        basePrice: Number(order.basePrice),
        markup: Number(order.markup),
        fee: Number(order.fee),
        paymentMethod: order.paymentMethod,
        serialNumber: order.serialNumber ?? null,
        paymentInvoice: order.paymentInvoice
          ? {
              status: order.paymentInvoice.status,
              paymentUrl: order.paymentInvoice.paymentUrl,
              paymentNumber: order.paymentInvoice.paymentNumber,
              method: order.paymentInvoice.method,
              expiredAt: order.paymentInvoice.expiredAt,
              paidAt: order.paymentInvoice.paidAt,
            }
          : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    log.error({ err }, "]");
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/orders/[code]", GET_handler);
