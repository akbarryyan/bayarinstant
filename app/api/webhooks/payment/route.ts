/**
 * POST /api/webhooks/payment
 *
 * Receives Pakasir payment completion webhook.
 *
 * Rules:
 * - Always return 200 OK to the gateway (otherwise gateway will retry indefinitely).
 * - Idempotency is handled inside HandlePakasirWebhookService.
 * - No business logic here.
 *
 * Routes:
 *   - order_id starts with "WT-" → wallet top-up
 *   - otherwise → order purchase
 */

import { NextResponse } from "next/server";
import { HandlePakasirWebhookService } from "@/src/core/services/payment/handle-pakasir-webhook.service";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { PakasirAdapter } from "@/src/infra/payment/pakasir/pakasir.adapter";
import { handleWalletTopupWebhook } from "@/lib/wallet-topup-webhook";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.legacy");

export const dynamic = "force-dynamic";

async function POST_handler(request: Request) {
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ received: false, error: "Invalid JSON" }, { status: 400 });
  }

  // ── Wallet top-up: order_id starts with "WT-" ─────────────────────────────
  if (String(payload.order_id ?? "").startsWith("WT-")) {
    try {
      const result = await handleWalletTopupWebhook(payload, new PakasirAdapter());
      return NextResponse.json({ received: true, ...result });
    } catch (err: unknown) {
      log.error({ err }, "legacy payment callback: wallet topup failed");
      return NextResponse.json({ received: true, error: "Topup processing error" }, { status: 200 });
    }
  }

  // ── Regular order purchase ─────────────────────────────────────────────────
  try {
    const webhookService = new HandlePakasirWebhookService(
      new OrderRepository(),
      new PakasirAdapter(),
    );
    const result = await webhookService.handle(payload, rawBody);
    log.info({ result }, "request failed");
    // Always acknowledge to gateway
    return NextResponse.json({ received: true, action: result.action });
  } catch (err: unknown) {
    // Log but still return 200 so gateway doesn't retry indefinitely
    log.error({ err }, "legacy payment callback processing failed");
    return NextResponse.json({ received: true, error: "Processing error" }, { status: 200 });
  }
}

export const POST = withRequestLog("/api/webhooks/payment", POST_handler);
