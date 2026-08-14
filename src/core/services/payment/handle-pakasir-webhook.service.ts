import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { IPaymentGatewayPort } from "@/src/core/ports/payment-gateway.port";
import { ExecuteProviderPurchaseService } from "@/src/core/services/provider/execute-provider-purchase.service";
import { OrderStatus, InvoiceStatus, WebhookSource } from "@/src/core/domain/enums/order.enum";
import { DuplicateWebhookError } from "@/src/core/domain/errors/domain.errors";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.pakasir");

export interface PakasirWebhookPayload {
  /** Pakasir sends order_id we passed during createPayment */
  order_id: string;
  invoice_id?: string;
  status: string; // completed | pending | expired | failed
  amount: number | string;
  fee?: number | string;
  total_payment?: number | string;
  method?: string;
  paid_at?: string;
  [key: string]: any;
}

export interface WebhookHandleResult {
  duplicate: boolean;
  action: "executed" | "ignored" | "already_paid" | "execute_failed";
  orderId?: string;
  executeError?: string;
}

/**
 * HandlePakasirWebhookService
 *
 * Flow baru (tanpa BullMQ):
 * - Idempotent via WebhookEvent.eventId (deduplication).
 * - Cross-check dengan gateway detailPayment.
 * - Execute provider LANGSUNG (inline) saat PAID, bukan enqueue.
 * - Anti double-execute: ExecuteProviderPurchaseService punya atomic claim.
 */
export class HandlePakasirWebhookService {
  private readonly executeService: ExecuteProviderPurchaseService;

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly paymentGateway: IPaymentGatewayPort,
  ) {
    this.executeService = new ExecuteProviderPurchaseService(orderRepo);
  }

  async handle(
    payload: PakasirWebhookPayload,
    rawBody: string
  ): Promise<WebhookHandleResult> {
    // ── Derive stable event ID ──────────────────────────────────────────────
    const eventId = `pakasir:${payload.order_id}:${payload.status}`;

    // ── Idempotency check ───────────────────────────────────────────────────
    const { event, duplicate } = await this.orderRepo.findOrCreateWebhookEvent({
      source: WebhookSource.PAKASIR,
      eventId,
      eventType: payload.status,
      payload: JSON.parse(rawBody),
    });

    if (duplicate) {
      log.info({ eventId }, "pakasir callback duplicate — ignored");
      return { duplicate: true, action: "ignored" };
    }

    try {
      const result = await this.processWebhook(payload);
      await this.orderRepo.markWebhookProcessed(eventId);
      return { ...result, duplicate: false };
    } catch (err: any) {
      await this.orderRepo.markWebhookProcessed(eventId, err.message);
      throw err;
    }
  }

  private async processWebhook(
    payload: PakasirWebhookPayload
  ): Promise<Omit<WebhookHandleResult, "duplicate">> {
    // Only process "completed" — ignore pending/expired/failed (nothing to do)
    if (payload.status !== "completed") {
      log.info({ gatewayStatus: payload.status }, "pakasir callback: non-completed status, no action");
      return { action: "ignored" };
    }

    // ── Find order by order_code ────────────────────────────────────────────
    const order = await this.orderRepo.findByCode(payload.order_id);

    if (!order) {
      log.warn({ orderCode: payload.order_id }, "pakasir callback: order not found");
      return { action: "ignored" };
    }

    // ── Already paid guard ──────────────────────────────────────────────────
    if (
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PROCESSING_PROVIDER ||
      order.status === OrderStatus.SUCCESS
    ) {
      log.info({ orderId: order.id, orderStatus: order.status }, "pakasir callback: order already past waiting payment");
      return { action: "already_paid", orderId: order.id };
    }

    // ── Cross-check with gateway (constitution §6.1) ────────────────────────
    const amount = Number(payload.amount);
    let detail;
    try {
      detail = await this.paymentGateway.detailPayment(payload.order_id, amount);
    } catch (err: any) {
      throw new Error(`detailPayment failed: ${err.message}`);
    }

    if (detail.status !== "completed") {
      log.warn(
        { orderCode: payload.order_id, gatewayStatus: detail.status },
        "pakasir callback ignored: gateway cross-check not completed"
      );
      return { action: "ignored" };
    }

    // ── Mark invoice PAID ───────────────────────────────────────────────────
    if (order.paymentInvoice) {
      await this.orderRepo.updateInvoiceStatus(
        order.paymentInvoice.invoiceId,
        InvoiceStatus.PAID,
        {
          paidAt: detail.paidAt ?? new Date(),
          rawPayload: payload,
        }
      );
    }

    // ── Transition order to PAID ────────────────────────────────────────────
    await this.orderRepo.updateStatus(order.id, OrderStatus.PAID);

    // ── Execute provider LANGSUNG (inline) ──────────────────────────────────
    try {
      await this.executeService.execute(order.id);
      log.info({ orderId: order.id }, "pakasir callback: order paid, provider executed");
      return { action: "executed" as const, orderId: order.id };
    } catch (execErr: any) {
      // Provider execution gagal tapi order tetap PAID — admin bisa reconcile
      log.error({ err: execErr, orderId: order.id }, "pakasir callback: order paid but provider execute failed");
      return { action: "execute_failed" as const, orderId: order.id, executeError: execErr.message };
    }
  }
}
