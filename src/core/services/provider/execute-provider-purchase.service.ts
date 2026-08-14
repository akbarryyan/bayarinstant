import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { ProviderFactory } from "@/src/infra/providers/provider.factory";
import { ProviderType } from "@/src/core/domain/enums/provider.enum";
import { OrderStatus } from "@/src/core/domain/enums/order.enum";
import { checkAndUpgradeUserTier } from "@/lib/pricing";
import { scheduleOrderReconcile } from "./reconcile-scheduler.service";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("order.execute");

/**
 * ExecuteProviderPurchaseService
 *
 * Dijalankan langsung (inline) saat webhook PAID atau checkout WALLET.
 * Tidak lagi menggunakan BullMQ queue.
 *
 * Idempotency & anti double-execute:
 * 1. Jika order sudah SUCCESS/FAILED → skip (terminal state).
 * 2. Jika order sudah punya providerRef → skip (sudah pernah call provider).
 * 3. Atomic claim via `claimForProcessing()` — hanya satu proses yang bisa
 *    mengubah status dari PAID → PROCESSING_PROVIDER (optimistic locking).
 *
 * Pada pending result: simpan providerRef, biarkan status PROCESSING_PROVIDER.
 * Admin bisa reconcile manual via API.
 */
export class ExecuteProviderPurchaseService {
  constructor(
    private readonly orderRepo: OrderRepository,
  ) {}

  private async handleProviderFailure(
    order: NonNullable<Awaited<ReturnType<OrderRepository["findById"]>>>,
    notes: string,
    providerRef?: string
  ) {
    if (order.paymentMethod === "WALLET" && order.userId) {
      await this.orderRepo.updateStatus(order.id, OrderStatus.FAILED, { notes, providerRef });
      await this.orderRepo.releaseWalletHold(order.userId, Number(order.amount), order.id);
      return;
    }

    if (order.paymentMethod === "PAYMENT_GATEWAY" && order.userId) {
      await this.orderRepo.refundPaidOrderToWallet(order.userId, Number(order.amount), order.id);
      await this.orderRepo.updateStatus(order.id, OrderStatus.REFUNDED, {
        notes: `${notes} Dana otomatis dikembalikan ke saldo akun.`,
        providerRef,
      });
      return;
    }

    await this.orderRepo.updateStatus(order.id, OrderStatus.FAILED, {
      notes: `${notes} Pembayaran sudah diterima. Hubungi CS untuk proses refund manual.`,
      providerRef,
    });
  }

  async execute(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);

    if (!order) {
      log.error({ orderId }, "execute: order not found");
      return;
    }

    // ── Idempotency guard: terminal state ─────────────────────────────────
    if (order.status === OrderStatus.SUCCESS || order.status === OrderStatus.FAILED) {
      log.info({ orderId, orderStatus: order.status }, "execute skipped: order already in terminal status");
      return;
    }

    // ── Anti double-execute: providerRef sudah ada → jangan call provider lagi
    if (order.providerRef) {
      log.info({ orderId, providerRef: order.providerRef }, "execute skipped: order already has providerRef");
      return;
    }

    // ── Atomic claim: PAID → PROCESSING_PROVIDER ──────────────────────────
    // Hanya satu proses yang bisa menang race condition ini
    const claimed = await this.orderRepo.claimForProcessing(orderId);
    if (!claimed) {
      log.info({ orderId }, "execute skipped: order already claimed by another process");
      return;
    }

    // ── Resolve provider ──────────────────────────────────────────────────
    const providerType = (order.provider ?? "DIGIFLAZZ") as ProviderType;
    const provider = ProviderFactory.create(providerType);

    // Build purchase request
    const rawTargetData = ((order.targetData as Record<string, unknown>) ?? {});
    const normalizedTargetData: Record<string, unknown> = {
      ...rawTargetData,
    };

    if (
      (normalizedTargetData.zone === undefined || normalizedTargetData.zone === null || normalizedTargetData.zone === "") &&
      (rawTargetData.zoneId !== undefined && rawTargetData.zoneId !== null && rawTargetData.zoneId !== "")
    ) {
      normalizedTargetData.zone = rawTargetData.zoneId;
    }

    if (
      (normalizedTargetData.server_id === undefined || normalizedTargetData.server_id === null || normalizedTargetData.server_id === "") &&
      (rawTargetData.serverId !== undefined && rawTargetData.serverId !== null && rawTargetData.serverId !== "")
    ) {
      normalizedTargetData.server_id = rawTargetData.serverId;
    }

    if (
      (normalizedTargetData.user_id === undefined || normalizedTargetData.user_id === null || normalizedTargetData.user_id === "") &&
      (rawTargetData.userId !== undefined && rawTargetData.userId !== null && rawTargetData.userId !== "")
    ) {
      normalizedTargetData.user_id = rawTargetData.userId;
    }

    const purchaseReq = {
      productCode: order.product.providerCode,
      target: order.targetNumber,
      additionalData: {
        ...normalizedTargetData,
        // Pass product type so adapters can route to the correct endpoint
        _productType: order.product.type,
      },
    };

    await this.orderRepo.logProviderAction({
      orderId,
      provider: providerType,
      action: "purchase:request",
      request: purchaseReq,
      success: true,
    });

    // ── Execute purchase ──────────────────────────────────────────────────
    let result;
    try {
      result = await provider.purchase(purchaseReq);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await this.orderRepo.logProviderAction({
        orderId,
        provider: providerType,
        action: "purchase:response",
        response: { error: message },
        success: false,
        errorMessage: message,
      });

      await this.handleProviderFailure(order, `Provider error: ${message}`);

      return;
    }

    await this.orderRepo.logProviderAction({
      orderId,
      provider: providerType,
      action: "purchase:response",
      response: result.rawResponse,
      success: result.success,
      errorMessage: result.success ? undefined : result.message,
    });

    // ── Update order based on result ──────────────────────────────────────
    if (result.success) {
      await this.orderRepo.updateStatus(orderId, OrderStatus.SUCCESS, {
        serialNumber: result.serialNumber,
        providerRef: result.transactionId,
      });

      await this.orderRepo.creditSellerCommission(orderId);

      // Finalize wallet debit ledger (balance was already reduced by HOLD)
      if (order.paymentMethod === "WALLET" && order.userId) {
        await this.orderRepo.finalizeDebitLedger(order.userId, Number(order.amount), orderId);
      }

      // Auto-upgrade tier based on accumulated success orders
      if (order.userId) {
        await checkAndUpgradeUserTier(order.userId);
      }

      log.info({ orderId, serialNumber: result.serialNumber }, "execute success");
    } else if (result.status === "pending") {
      // Provider returned pending → simpan providerRef, biarkan PROCESSING_PROVIDER
      // Admin bisa reconcile manual via /api/admin/transactions/:id/reconcile
      await this.orderRepo.updateStatus(orderId, OrderStatus.PROCESSING_PROVIDER, {
        providerRef: result.transactionId,
      });
      scheduleOrderReconcile(orderId);

      log.info({ orderId, providerRef: result.transactionId }, "execute pending at provider");
    } else {
      await this.handleProviderFailure(order, result.message, result.transactionId);

      log.warn({ orderId, providerMessage: result.message }, "execute failed at provider");
    }
  }
}
