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
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.orders");

export const dynamic = "force-dynamic";

const orderRepo = new OrderRepository();

/**
 * Menyisakan awalan dan akhiran secukupnya supaya pemilik pesanan masih
 * mengenali nomornya sendiri, tanpa memberi nomor utuh kepada penebak kode.
 * Dipakai untuk nomor HP, ID game, maupun nomor pelanggan PLN.
 */
function maskTargetNumber(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return "*".repeat(trimmed.length);

  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-3);
  return `${head}${"*".repeat(trimmed.length - 6)}${tail}`;
}

async function GET_handler(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    // Endpoint ini boleh diakses tanpa login, dan kode order berpola
    // WP-YYMMDD- + 6 hex. Pembatas laju inilah yang membuat menyapu seluruh
    // ruang kode dalam sehari menjadi tidak praktis.
    const denied = enforceRateLimit(request.headers, "order-lookup", RATE_LIMITS.orderLookup);
    if (denied) return denied;

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

    // `order.userId` wajib dicek lebih dulu: pada order guest keduanya null,
    // dan `null === null` akan memberi akses penuh ke pengunjung anonim.
    const isOwnerOrAdmin =
      session.role === "ADMIN" ||
      (Boolean(order.userId) && sessionUserId === order.userId);

    let hasFullAccess = isOwnerOrAdmin;

    if (!hasFullAccess && rawToken) {
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      if (!order.viewTokenHash || order.viewTokenHash !== tokenHash) {
        return NextResponse.json({ success: false, error: "Invalid token" }, { status: 403 });
      }
      hasFullAccess = true;
    }

    if (order.status === "PAID" || order.status === "PROCESSING_PROVIDER") {
      const reconciled = await autoReconcileOrderNow(order.id);
      if (reconciled) {
        order = reconciled;
      }
    }

    // ── Shape response ─────────────────────────────────────────────────────
    // Bentuknya sengaja sama untuk kedua tingkat akses: field sensitif diisi
    // null, bukan dihilangkan, supaya halaman yang sudah ada tidak menemukan
    // `undefined` di tempat yang ia harap ada nilainya.
    const publicView = {
      orderCode: order.orderCode,
      status: order.status,
      product: {
        name: order.product.name,
        category: order.product.category,
        brand: order.product.brand,
      },
      amount: Number(order.amount),
      fee: Number(order.fee),
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };

    if (!hasFullAccess) {
      // Cukup untuk menjawab "pesanan saya sampai mana", tanpa menyerahkan
      // barangnya. `serialNumber` adalah voucher yang dibeli dan
      // `paymentNumber` adalah string QRIS-nya — keduanya bernilai bagi siapa
      // pun yang menebak kode order.
      return NextResponse.json({
        success: true,
        data: {
          ...publicView,
          redacted: true,
          targetNumber: maskTargetNumber(order.targetNumber),
          targetData: null,
          notes: null,
          serialNumber: null,
          paymentInvoice: order.paymentInvoice
            ? {
                status: order.paymentInvoice.status,
                method: order.paymentInvoice.method,
                expiredAt: order.paymentInvoice.expiredAt,
                paidAt: order.paymentInvoice.paidAt,
                paymentUrl: null,
                paymentNumber: null,
              }
            : null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...publicView,
        redacted: false,
        targetNumber: order.targetNumber,
        targetData: order.targetData,
        notes: order.notes ?? null,
        basePrice: Number(order.basePrice),
        markup: Number(order.markup),
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
      },
    });
  } catch (err) {
    log.error({ err }, "]");
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/orders/[code]", GET_handler);
