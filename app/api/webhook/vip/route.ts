/**
 * POST /api/webhook/vip
 *
 * Menerima notifikasi status transaksi dari VIP Reseller (Prepaid & Game/Streaming).
 * Berlaku untuk kedua jenis — strukturnya sama.
 *
 * Whitelist IP VIP Reseller: 178.248.73.218
 *
 * Header:
 *   X-Client-Signature: md5(API_ID + API_KEY)
 *
 * Payload:
 *   {
 *     result: true,
 *     data: [{ trxid, data, service, status, note, price }],
 *     message: "..."
 *   }
 *
 * Status dari VIP:
 *   waiting / processing → PROCESSING_PROVIDER (abaikan, tunggu update berikutnya)
 *   success              → SUCCESS
 *   error                → FAILED
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { OrderStatus } from "@/src/core/domain/enums/order.enum";
import { checkAndUpgradeUserTier } from "@/lib/pricing";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.vip");

export const dynamic = "force-dynamic";

// IP resmi VIP Reseller yang boleh kirim webhook
const VIP_WEBHOOK_IP = "178.248.73.218";

function ok() {
  return NextResponse.json({ success: true }, { status: 200 });
}

async function POST_handler(req: NextRequest) {
  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    log.error("failed to parse JSON body");
    return ok(); // kembalikan 200 agar VIP tidak retry
  }

  log.info({ payload }, "vip callback received");

  // ── 2. Validasi signature ─────────────────────────────────────────────────
  const signature = req.headers.get("x-client-signature") ?? "";
  const apiId = process.env.VIP_API_ID ?? "";
  const apiKey = process.env.VIP_API_KEY ?? "";
  const expectedSig = createHash("md5").update(apiId + apiKey).digest("hex");

  if (signature && expectedSig && signature !== expectedSig) {
    log.warn({ signature }, "invalid signature. Received");
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Validasi IP (optional extra security) ───────────────────────────────
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = forwardedFor.split(",")[0].trim();
  if (clientIp && clientIp !== VIP_WEBHOOK_IP) {
    log.warn({ clientIp }, "vip callback from unexpected ip");
    // Log only — jangan reject karena bisa jadi ada proxy/CDN
  }

  // ── 4. Normalise payload — Prepaid: data adalah array, Game: data adalah object ──
  if (!payload.data) {
    log.warn("missing data field in payload");
    return ok();
  }

  // Normalise: pastikan item selalu berupa single object
  const item = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const { trxid, status: vipStatus, note } = item;

  if (!trxid) {
    log.warn("missing trxid in webhook payload");
    return ok();
  }

  // ── 5. Map status VIP → status internal ───────────────────────────────────
  // waiting / processing → masih berjalan, abaikan (tunggu webhook success/error)
  if (vipStatus === "waiting" || vipStatus === "processing") {
    log.info({ trxid, vipStatus }, "vip callback ignored: interim status");
    return ok();
  }

  const isFinal = vipStatus === "success" || vipStatus === "error";
  if (!isFinal) {
    log.warn({ trxid, vipStatus }, "vip callback ignored: unknown status");
    return ok();
  }

  // ── 6. Cari order berdasarkan providerRef ─────────────────────────────────
  const orderRepo = new OrderRepository();
  const order = await orderRepo.findByProviderRef(trxid);

  if (!order) {
    log.warn({ providerRef: trxid }, "vip callback: no matching order");
    return ok();
  }

  if (order.status === OrderStatus.SUCCESS) {
    await orderRepo.creditSellerCommission(order.id).catch((error) => {
      log.error({ err: error, orderId: order.id }, "vip callback: seller commission backfill failed");
    });
    log.info({ orderId: order.id }, "vip callback: order already success");
    return ok();
  }

  // Jika order sudah terminal gagal, skip
  if (order.status === OrderStatus.FAILED) {
    log.info({ orderId: order.id }, "vip callback: order already failed");
    return ok();
  }

  // ── 7. Update order status ────────────────────────────────────────────────
  if (vipStatus === "success") {
    // SN biasanya ada di note
    const serialNumber = note && note !== "" ? note : undefined;

    await orderRepo.updateStatus(order.id, OrderStatus.SUCCESS, {
      serialNumber,
      notes: `VIP webhook: success${serialNumber ? ` | SN: ${serialNumber}` : ""}`,
    });

    await orderRepo.creditSellerCommission(order.id);

    // Finalize wallet debit jika bayar pakai wallet
    if (order.paymentMethod === "WALLET" && order.userId) {
      await orderRepo.finalizeDebitLedger(order.userId, Number(order.amount), order.id);
    }

    // Cek upgrade tier
    if (order.userId) {
      await checkAndUpgradeUserTier(order.userId).catch(() => {});
    }

    log.info({ orderId: order.id, serialNumber: serialNumber ?? null }, "vip callback: order success");
  } else {
    // vipStatus === "error"
    await orderRepo.updateStatus(order.id, OrderStatus.FAILED, {
      notes: `VIP webhook: error | ${note || "No note"}`,
    });

    // Kembalikan saldo wallet jika bayar pakai wallet
    if (order.paymentMethod === "WALLET" && order.userId) {
      await orderRepo.releaseWalletHold(order.userId, Number(order.amount), order.id);
    }

    log.warn({ orderId: order.id, note }, "vip callback: order failed");
  }

  return ok();
}

export const POST = withRequestLog("/api/webhook/vip", POST_handler);
