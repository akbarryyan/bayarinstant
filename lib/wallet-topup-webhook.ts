/**
 * lib/wallet-topup-webhook.ts
 *
 * Shared logic for processing Pakasir webhook callbacks for wallet top-ups.
 * Called from both /api/webhook/pakasir and /api/webhooks/payment
 * when order_id starts with "WT-".
 */

import { prisma } from "@/src/infra/db/prisma";
import { IPaymentGatewayPort } from "@/src/core/ports/payment-gateway.port";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("wallet.topup");

export interface TopupWebhookResult {
  action: "completed" | "already_completed" | "ignored" | "not_found";
  topupId?: string;
}

export async function handleWalletTopupWebhook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  gateway: IPaymentGatewayPort
): Promise<TopupWebhookResult> {
  const topupCode: string = String(payload.order_id ?? "");
  const status: string    = String(payload.status ?? "").toLowerCase();

  log.info({ topupCode, gatewayStatus: status }, "wallet topup callback received");

  // Only process "completed" status
  if (status !== "completed") {
    if (status === "expired" || status === "failed") {
      // Mark as expired/failed if still pending
      await prisma.walletTopup.updateMany({
        where: { topupCode, status: "PENDING" },
        data: { status: status === "expired" ? "EXPIRED" : "FAILED" },
      });
    }
    return { action: "ignored" };
  }

  // Find topup record
  const topup = await prisma.walletTopup.findUnique({
    where: { topupCode },
  });

  if (!topup) {
    log.warn({ topupCode }, "wallet topup callback: topup not found");
    return { action: "not_found" };
  }

  // Already processed guard
  if (topup.status === "COMPLETED") {
    log.info({ topupCode }, "wallet topup callback: already completed");
    return { action: "already_completed", topupId: topup.id };
  }

  // Cross-check with gateway
  const amount = Number(payload.amount ?? topup.amount);
  let detail;
  try {
    detail = await gateway.detailPayment(topupCode, amount);
  } catch (err: unknown) {
    throw new Error(`detailPayment failed: ${err instanceof Error ? err.message : err}`);
  }

  if (detail.status !== "completed") {
    log.warn({ topupCode, gatewayStatus: detail.status }, "wallet topup callback ignored: gateway cross-check not completed");
    return { action: "ignored" };
  }

  // Credit wallet atomically
  await prisma.$transaction(async (tx) => {
    // Upsert wallet (ensure it exists)
    const wallet = await tx.wallet.upsert({
      where: { userId: topup.userId },
      create: { userId: topup.userId, balance: 0 },
      update: {},
    });

    const balanceBefore = Number(wallet.balance);
    const creditAmount  = Number(topup.amount);
    const balanceAfter  = balanceBefore + creditAmount;

    // Update balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });

    // Write ledger entry
    await tx.ledgerEntry.create({
      data: {
        walletId:      wallet.id,
        type:          "CREDIT",
        amount:        creditAmount,
        balanceBefore,
        balanceAfter,
        reference:     topupCode,
        description:   `Top Up Saldo via ${detail.method ?? "Payment Gateway"}`,
      },
    });

    // Mark topup COMPLETED
    await tx.walletTopup.update({
      where: { id: topup.id },
      data: {
        status:        "COMPLETED",
        paymentMethod: detail.method ?? topup.paymentMethod,
        paidAt:        detail.paidAt ?? new Date(),
        fee:           detail.fee,
        totalPayment:  detail.totalPayment,
      },
    });
  });

  log.info({ topupCode, userId: topup.userId, amount: topup.amount }, "wallet topup credited");

  return { action: "completed", topupId: topup.id };
}
