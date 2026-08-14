/**
 * POST /api/webhook/pakasir
 *
 * Receives payment status notification from Pakasir.
 * Must return HTTP 200 immediately — Pakasir retries on failure.
 *
 * Expected payload (from Pakasir):
 *   { order_id, status, amount, fee?, total_payment?, method?, paid_at?, ... }
 *
 * Routes:
 *   - order_id starts with "WT-" → wallet top-up
 *   - otherwise → order purchase
 */

import { NextResponse } from "next/server";
import { HandlePakasirWebhookService } from "@/src/core/services/payment/handle-pakasir-webhook.service";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { PakasirAdapter } from "@/src/infra/payment/pakasir/pakasir.adapter";
import { getPakasirMode } from "@/lib/site-config";
import { handleWalletTopupWebhook } from "@/lib/wallet-topup-webhook";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.pakasir");

export const dynamic = "force-dynamic";

async function POST_handler(request: Request) {
  // ── 1. Read raw body (needed for logging & idempotency) ──────────────────
  let rawBody: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;

  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    log.error("failed to parse request body");
    // Return 200 to prevent Pakasir from retrying a malformed payload
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 200 });
  }

  log.info({ orderCode: payload.order_id, gatewayStatus: payload.status }, "pakasir callback received");

  // ── 2. Validate minimum required fields ──────────────────────────────────
  if (!payload.order_id || !payload.status) {
    log.error("missing order_id or status in payload");
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 200 });
  }

  // ── 3. Wallet top-up: order_id starts with "WT-" ─────────────────────────
  if (String(payload.order_id).startsWith("WT-")) {
    try {
      const pakasirMode = await getPakasirMode();
      const result = await handleWalletTopupWebhook(payload, new PakasirAdapter(pakasirMode));
      return NextResponse.json({ success: true, ...result }, { status: 200 });
    } catch (err: unknown) {
      log.error({ err }, "pakasir callback: wallet topup failed");
      return NextResponse.json({ success: false, error: "Topup processing error" }, { status: 200 });
    }
  }

  // ── 4. Regular order purchase ─────────────────────────────────────────────
  const orderRepo = new OrderRepository();
  const pakasirMode = await getPakasirMode();
  const paymentGateway = new PakasirAdapter(pakasirMode);

  const service = new HandlePakasirWebhookService(orderRepo, paymentGateway);

  try {
    const result = await service.handle(payload, rawBody);
    log.info({ result }, "result");
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err: unknown) {
    // Log error but still return 200 so Pakasir does not retry indefinitely for
    // transient errors that we've already recorded (idempotency record created).
    log.error({ err }, "pakasir callback processing failed");
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Error" }, { status: 200 });
  }
}

export const POST = withRequestLog("/api/webhook/pakasir", POST_handler);
