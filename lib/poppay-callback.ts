import { prisma } from "@/src/infra/db/prisma";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { ExecuteProviderPurchaseService } from "@/src/core/services/provider/execute-provider-purchase.service";
import { InvoiceStatus, OrderStatus, WebhookSource } from "@/src/core/domain/enums/order.enum";
import { PoppayClient } from "@/src/infra/payment/poppay/poppay.client";
import { createLogger } from "@/src/infra/logging/logger";
import { setRequestContext } from "@/src/infra/logging/request-context";

const log = createLogger("webhook.poppay", { module: "callback" });

export interface PoppayCallbackPayload {
  refid: string;
  agg_refid: string;
  amount: number;
  status: number;
  trx_date?: string;
  [key: string]: unknown;
}

export interface PoppayCallbackResult {
  duplicate: boolean;
  action:
    | "completed_topup"
    | "completed_order"
    | "completed_withdrawal"
    | "expired_topup"
    | "expired_order"
    | "expired_withdrawal"
    | "failed_topup"
    | "failed_order"
    | "failed_withdrawal"
    | "cancelled_withdrawal"
    | "rejected_withdrawal"
    | "obscure_withdrawal"
    | "already_completed"
    | "ignored"
    | "not_found"
    | "execute_failed"
    | "inquiry_mismatch"
    | "refid_mismatch"
    | "amount_mismatch";
  orderId?: string;
  topupId?: string;
  withdrawalId?: string;
  executeError?: string;
}

/**
 * Gerbang cross-check sebelum menandai lunas. Perhatikan: semua error di sini
 * diturunkan jadi `false`, artinya gangguan jaringan sesaat pun membuat
 * callback pembayaran asli ditolak. Karena itu hasilnya SELALU dilog — dulu
 * hanya cabang exception yang tercatat.
 */
async function confirmCompletedViaInquiry(refId: string): Promise<boolean> {
  try {
    const client = new PoppayClient();
    const inquiry = await client.inquireIncoming(refId);
    const confirmed = inquiry.status === "completed";
    log.info(
      { refId, inquiryStatus: inquiry.status, statusCode: inquiry.statusCode, confirmed },
      "poppay callback inquiry cross-check"
    );
    return confirmed;
  } catch (error) {
    log.error({ err: error, refId }, "poppay callback inquiry verification failed");
    return false;
  }
}

/** Kode status Poppay untuk transaksi lunas. */
const POPPAY_STATUS_PAID = 5;

function resolveTopupTerminalStatus(status: number): "COMPLETED" | "EXPIRED" | "FAILED" | null {
  if (status === 5) return "COMPLETED";
  if (status === 3) return "EXPIRED";
  if (status === 1 || status === 2 || status === 4) return "FAILED";
  return null;
}

function resolveWithdrawalCallbackOutcome(status: number):
  | { kind: "COMPLETED"; requestStatus: "PAID"; action: "completed_withdrawal"; shouldRelease: false }
  | { kind: "REJECTED"; requestStatus: "REJECTED"; action: "rejected_withdrawal"; shouldRelease: true }
  | { kind: "CANCELLED"; requestStatus: "CANCELLED"; action: "cancelled_withdrawal"; shouldRelease: true }
  | { kind: "EXPIRED"; requestStatus: "CANCELLED"; action: "expired_withdrawal"; shouldRelease: true }
  | { kind: "OBSCURE"; requestStatus: "APPROVED"; action: "obscure_withdrawal"; shouldRelease: false }
  | null {
  if (status === 5) return { kind: "COMPLETED", requestStatus: "PAID", action: "completed_withdrawal", shouldRelease: false };
  if (status === 1) return { kind: "REJECTED", requestStatus: "REJECTED", action: "rejected_withdrawal", shouldRelease: true };
  if (status === 2) return { kind: "CANCELLED", requestStatus: "CANCELLED", action: "cancelled_withdrawal", shouldRelease: true };
  if (status === 3) return { kind: "EXPIRED", requestStatus: "CANCELLED", action: "expired_withdrawal", shouldRelease: true };
  if (status === 4) return { kind: "OBSCURE", requestStatus: "APPROVED", action: "obscure_withdrawal", shouldRelease: false };
  return null;
}

function resolveInvoiceTerminalStatus(status: number): InvoiceStatus | null {
  if (status === 5) return InvoiceStatus.PAID;
  if (status === 3) return InvoiceStatus.EXPIRED;
  if (status === 2) return InvoiceStatus.CANCELLED;
  if (status === 1 || status === 4) return InvoiceStatus.CANCELLED;
  return null;
}

function resolveOrderTerminalStatus(status: number): OrderStatus | null {
  if (status === 5) return OrderStatus.PAID;
  if (status === 3) return OrderStatus.EXPIRED;
  if (status === 1 || status === 2 || status === 4) return OrderStatus.FAILED;
  return null;
}

function resolvePaidAt(trxDate?: string): Date {
  if (!trxDate) return new Date();
  const parsed = new Date(trxDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function resolveOrderCodeFromAggRefId(aggRefId: string): string {
  const [orderCode] = String(aggRefId).split("__R");
  return orderCode || String(aggRefId);
}

/** Satu baris penutup siklus: apa yang akhirnya dilakukan callback ini. */
function logHandled(
  eventId: string,
  payload: PoppayCallbackPayload,
  result: Omit<PoppayCallbackResult, "duplicate">
): void {
  const level =
    result.action === "refid_mismatch" || result.action === "amount_mismatch"
      ? "error"
      : result.action === "not_found" ||
        result.action === "inquiry_mismatch" ||
        result.action === "execute_failed"
      ? "warn"
      : "info";

  log[level](
    {
      eventId,
      aggRefId: payload.agg_refid,
      refId: payload.refid,
      gatewayStatus: payload.status,
      action: result.action,
      orderId: result.orderId,
      topupId: result.topupId,
      withdrawalId: result.withdrawalId,
      executeError: result.executeError,
    },
    "poppay callback handled"
  );
}

/**
 * Alasan kenapa sebuah callback belum boleh dianggap tuntas.
 *
 * Dua outcome di bawah ini bukan kesimpulan akhir, hanya potret sesaat:
 * - `not_found` — order/topup/withdrawal belum terlihat saat callback tiba.
 * - `inquiry_mismatch` — cross-check ke Poppay tidak mengonfirmasi lunas.
 *   `confirmCompletedViaInquiry()` menurunkan SEMUA error jadi `false`, jadi
 *   satu timeout jaringan saja sudah cukup untuk sampai ke sini.
 *
 * Keduanya dikembalikan sebagai "error" ke `markWebhookProcessed()` supaya
 * baris event tetap `processed: false` — satu-satunya cara retry Poppay
 * berikutnya masih diproses, bukan dibuang sebagai duplikat.
 */
function retryReasonFor(action: PoppayCallbackResult["action"]): string | undefined {
  if (action === "not_found") return "Data terkait callback belum ditemukan";
  if (action === "inquiry_mismatch") return "Cross-check inquiry Poppay belum mengonfirmasi lunas";
  if (action === "refid_mismatch") return "refid callback bukan invoice yang kita terbitkan";
  if (action === "amount_mismatch") return "Nominal callback tidak sama dengan yang ditagihkan";
  return undefined;
}

/**
 * Callback Poppay hanya boleh menyentuh transaksi yang refid-nya memang kita
 * terbitkan untuk transaksi itu.
 *
 * Tanpa pengikatan ini, satu-satunya pengaman adalah
 * `confirmCompletedViaInquiry()` — dan inquiry cuma menjawab "apakah refid ini
 * lunas di Poppay", bukan "apakah refid ini milik order ini". Signature pun
 * tidak menutup celahnya karena verifikasinya masih opsional. Artinya siapa pun
 * yang memegang satu refid lunas yang sah (misalnya hasil membayar Rp1.000
 * sendiri) bisa mengirim callback dengan agg_refid order mana pun dan order itu
 * akan diproses.
 *
 * Nominal hanya dicek saat callback mengklaim lunas (status 5). Untuk status
 * lain — expired, cancel — nominal bukan keputusan uang, dan gateway belum
 * tentu mengisinya; mengecek di sana hanya akan menggantung order yang
 * seharusnya bisa ditutup.
 */
function findCallbackBindingViolation(input: {
  payload: PoppayCallbackPayload;
  boundInvoiceId: string | null | undefined;
  billedTotal: number;
}): "refid_mismatch" | "amount_mismatch" | null {
  const { payload, boundInvoiceId, billedTotal } = input;

  if (!boundInvoiceId || boundInvoiceId !== payload.refid) return "refid_mismatch";

  if (payload.status === POPPAY_STATUS_PAID) {
    const paid = Number(payload.amount);
    if (!Number.isFinite(paid) || paid !== billedTotal) return "amount_mismatch";
  }

  return null;
}

export async function handlePoppayCallback(
  payload: PoppayCallbackPayload,
  rawPayload: unknown
): Promise<PoppayCallbackResult> {
  const orderRepo = new OrderRepository();
  const eventId = `poppay:${payload.agg_refid}:${payload.status}:${payload.refid}`;
  const { duplicate } = await orderRepo.findOrCreateWebhookEvent({
    source: WebhookSource.POPPAY,
    eventId,
    eventType: String(payload.status),
    payload: rawPayload as Parameters<OrderRepository["findOrCreateWebhookEvent"]>[0]["payload"],
  });

  setRequestContext({ provider: "POPPAY", paymentMethod: "PAYMENT_GATEWAY" });

  if (duplicate) {
    // Retry dari Poppay dengan refid+status yang sama. Dulu sepenuhnya senyap,
    // padahal inilah yang membuat callback gagal tidak pernah bisa sembuh.
    log.info(
      { eventId, aggRefId: payload.agg_refid, gatewayStatus: payload.status },
      "poppay callback duplicate — ignored"
    );
    return { duplicate: true, action: "ignored" };
  }

  try {
    const paidAt = resolvePaidAt(payload.trx_date);

    if (String(payload.agg_refid).startsWith("WT-")) {
      const result = await handlePoppayTopup(payload, paidAt);
      await orderRepo.markWebhookProcessed(eventId, retryReasonFor(result.action));
      logHandled(eventId, payload, result);
      return { duplicate: false, ...result };
    }

    if (String(payload.agg_refid).startsWith("withdraw-")) {
      const result = await handlePoppayWithdrawal(payload);
      await orderRepo.markWebhookProcessed(eventId, retryReasonFor(result.action));
      logHandled(eventId, payload, result);
      return { duplicate: false, ...result };
    }

    const result = await handlePoppayOrder(payload, paidAt);
    await orderRepo.markWebhookProcessed(eventId, retryReasonFor(result.action));
    logHandled(eventId, payload, result);
    return { duplicate: false, ...result };
  } catch (error) {
    await orderRepo.markWebhookProcessed(
      eventId,
      error instanceof Error ? error.message : "Unknown callback error"
    );
    log.error(
      { err: error, eventId, aggRefId: payload.agg_refid, gatewayStatus: payload.status },
      "poppay callback processing failed"
    );
    throw error;
  }
}

async function handlePoppayWithdrawal(
  payload: PoppayCallbackPayload
): Promise<Omit<PoppayCallbackResult, "duplicate">> {
  const withdrawal = await prisma.sellerWithdrawalRequest.findFirst({
    where: {
      OR: [
        { payoutAggRefId: payload.agg_refid },
        { payoutRefId: payload.refid },
        { id: String(payload.agg_refid).replace(/^withdraw-/, "") },
      ],
    },
  });

  if (!withdrawal) {
    return { action: "not_found" };
  }

  if (withdrawal.status === "PAID") {
    return { action: "already_completed", withdrawalId: withdrawal.id };
  }

  const outcome = resolveWithdrawalCallbackOutcome(payload.status);
  if (!outcome) {
    return { action: "ignored", withdrawalId: withdrawal.id };
  }

  if (outcome.kind === "OBSCURE") {
    await prisma.sellerWithdrawalRequest.update({
      where: { id: withdrawal.id },
      data: {
        payoutRefId: payload.refid,
        payoutAggRefId: payload.agg_refid,
        payoutRawPayload: rawPayloadJson(payload),
        processedNote: `Poppay callback status=4 (Obscure). Perlu review manual.`,
        processedAt: new Date(),
      },
    });

    return { action: outcome.action, withdrawalId: withdrawal.id };
  }

  if (outcome.kind === "COMPLETED") {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
      const existingPaidLedger = wallet
        ? await tx.ledgerEntry.findFirst({
            where: {
              walletId: wallet.id,
              type: "WITHDRAW_PAID",
              reference: withdrawal.id,
            },
            select: { id: true },
          })
        : null;

      if (wallet && !existingPaidLedger) {
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            type: "WITHDRAW_PAID",
            amount: withdrawal.amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance,
            reference: withdrawal.id,
            description: `Withdraw seller dibayar ${withdrawal.id}`,
          },
        });
      }

      await tx.sellerWithdrawalRequest.update({
        where: { id: withdrawal.id },
        data: {
          status: outcome.requestStatus,
          payoutRefId: payload.refid,
          payoutAggRefId: payload.agg_refid,
          payoutRawPayload: rawPayloadJson(payload),
          processedAt: new Date(),
        },
      });
    });

    return { action: outcome.action, withdrawalId: withdrawal.id };
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.sellerWithdrawalRequest.findUnique({
      where: { id: withdrawal.id },
    });

    if (!current || current.status === "REJECTED" || current.status === "CANCELLED") {
      return;
    }

    const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
    const hasReleaseLedger = wallet
      ? await tx.ledgerEntry.findFirst({
          where: {
            walletId: wallet.id,
            type: "WITHDRAW_RELEASE",
            reference: withdrawal.id,
          },
          select: { id: true },
        })
      : null;

    if (wallet && !hasReleaseLedger && outcome.shouldRelease) {
      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + Number(withdrawal.amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter },
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: "WITHDRAW_RELEASE",
          amount: withdrawal.amount,
          balanceBefore,
          balanceAfter,
          reference: withdrawal.id,
          description: `Release withdraw seller ${withdrawal.id} setelah payout gagal/expired`,
        },
      });
    }

    await tx.sellerWithdrawalRequest.update({
      where: { id: withdrawal.id },
      data: {
        status: outcome.requestStatus,
        payoutRefId: payload.refid,
        payoutAggRefId: payload.agg_refid,
        payoutRawPayload: rawPayloadJson(payload),
        processedNote:
          outcome.kind === "REJECTED"
            ? "Poppay callback status=1 (Reject)."
            : outcome.kind === "CANCELLED"
            ? "Poppay callback status=2 (Cancel)."
            : "Poppay callback status=3 (Expired).",
        processedAt: new Date(),
      },
    });
  });

  return { action: outcome.action, withdrawalId: withdrawal.id };
}

async function handlePoppayTopup(
  payload: PoppayCallbackPayload,
  paidAt: Date
): Promise<Omit<PoppayCallbackResult, "duplicate">> {
  const topup = await prisma.walletTopup.findUnique({
    where: { topupCode: payload.agg_refid },
  });

  if (!topup) {
    return { action: "not_found" };
  }

  if (topup.status === "COMPLETED") {
    return { action: "already_completed", topupId: topup.id };
  }

  const topupTotal = Number(topup.totalPayment ?? 0);
  const violation = findCallbackBindingViolation({
    payload,
    boundInvoiceId: topup.invoiceId,
    billedTotal: topupTotal > 0 ? topupTotal : Number(topup.amount),
  });

  if (violation) {
    log.error(
      {
        topupId: topup.id,
        topupCode: topup.topupCode,
        refId: payload.refid,
        boundInvoiceId: topup.invoiceId ?? null,
        callbackAmount: payload.amount,
        violation,
      },
      "poppay callback ditolak: tidak terikat ke invoice topup ini"
    );
    return { action: violation, topupId: topup.id };
  }

  const terminalStatus = resolveTopupTerminalStatus(payload.status);
  if (!terminalStatus) {
    return { action: "ignored", topupId: topup.id };
  }

  if (terminalStatus !== "COMPLETED") {
    await prisma.walletTopup.update({
      where: { id: topup.id },
      data: {
        status: terminalStatus,
        paymentMethod: topup.paymentMethod ?? "qris",
        invoiceId: topup.invoiceId ?? payload.refid,
      },
    });

    return {
      action: terminalStatus === "EXPIRED" ? "expired_topup" : "failed_topup",
      topupId: topup.id,
    };
  }

  const inquiryConfirmed = await confirmCompletedViaInquiry(payload.refid);
  if (!inquiryConfirmed) {
    return { action: "inquiry_mismatch", topupId: topup.id };
  }

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId: topup.userId },
      create: { userId: topup.userId, balance: 0 },
      update: {},
    });

    const balanceBefore = Number(wallet.balance);
    const creditAmount = Number(topup.amount);
    const balanceAfter = balanceBefore + creditAmount;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: "CREDIT",
        amount: creditAmount,
        balanceBefore,
        balanceAfter,
        reference: topup.topupCode,
        description: "Top Up Saldo via POPPAY QRIS",
      },
    });

    await tx.walletTopup.update({
      where: { id: topup.id },
      data: {
        status: "COMPLETED",
        paymentMethod: "qris",
        invoiceId: topup.invoiceId ?? payload.refid,
        paidAt,
        fee: Number(topup.fee ?? 0),
        totalPayment: Number(topup.totalPayment ?? topup.amount),
      },
    });
  });

  return { action: "completed_topup", topupId: topup.id };
}

async function handlePoppayOrder(
  payload: PoppayCallbackPayload,
  paidAt: Date
): Promise<Omit<PoppayCallbackResult, "duplicate">> {
  const orderRepo = new OrderRepository();
  const executeService = new ExecuteProviderPurchaseService(orderRepo);
  const resolvedOrderCode = resolveOrderCodeFromAggRefId(payload.agg_refid);
  const order = await orderRepo.findByCode(resolvedOrderCode);

  if (!order) {
    return { action: "not_found" };
  }

  if (
    order.status === OrderStatus.PAID ||
    order.status === OrderStatus.PROCESSING_PROVIDER ||
    order.status === OrderStatus.SUCCESS
  ) {
    return { action: "already_completed", orderId: order.id };
  }

  // Diperiksa SEBELUM invoice atau order disentuh: callback yang tidak terikat
  // ke order ini tidak boleh meninggalkan jejak apa pun.
  const invoiceTotal = Number(order.paymentInvoice?.totalPayment ?? 0);
  const violation = findCallbackBindingViolation({
    payload,
    boundInvoiceId: order.paymentInvoice?.invoiceId,
    // Baris invoice lama bisa punya totalPayment 0; order.amount menyimpan
    // nominal yang sama setelah fee gateway diketahui.
    billedTotal: invoiceTotal > 0 ? invoiceTotal : Number(order.amount),
  });

  if (violation) {
    log.error(
      {
        orderId: order.id,
        orderCode: order.orderCode,
        refId: payload.refid,
        boundInvoiceId: order.paymentInvoice?.invoiceId ?? null,
        callbackAmount: payload.amount,
        violation,
      },
      "poppay callback ditolak: tidak terikat ke invoice order ini"
    );
    return { action: violation, orderId: order.id };
  }

  const invoiceStatus = resolveInvoiceTerminalStatus(payload.status);
  const orderStatus = resolveOrderTerminalStatus(payload.status);

  if (!invoiceStatus || !orderStatus) {
    return { action: "ignored", orderId: order.id };
  }

  if (order.paymentInvoice) {
    await prisma.paymentInvoice.update({
      where: { id: order.paymentInvoice.id },
      data: {
        invoiceId: order.paymentInvoice.invoiceId || payload.refid,
        method: order.paymentInvoice.method ?? "qris",
        status: invoiceStatus,
        paidAt: invoiceStatus === InvoiceStatus.PAID ? paidAt : order.paymentInvoice.paidAt,
        rawPayload: rawPayloadJson(payload),
      },
    });
  }

  if (orderStatus !== OrderStatus.PAID) {
    await orderRepo.updateStatus(order.id, orderStatus, {
      notes: `POPPAY callback status=${payload.status}`,
    });
    return {
      action: orderStatus === OrderStatus.EXPIRED ? "expired_order" : "failed_order",
      orderId: order.id,
    };
  }

  const inquiryConfirmed = await confirmCompletedViaInquiry(payload.refid);
  if (!inquiryConfirmed) {
    return { action: "inquiry_mismatch", orderId: order.id };
  }

  await orderRepo.updateStatus(order.id, OrderStatus.PAID);

  try {
    await executeService.execute(order.id);
    return { action: "completed_order", orderId: order.id };
  } catch (error) {
    return {
      action: "execute_failed",
      orderId: order.id,
      executeError: error instanceof Error ? error.message : "Unknown execute error",
    };
  }
}

function rawPayloadJson(payload: PoppayCallbackPayload) {
  return payload as unknown as NonNullable<
    Parameters<OrderRepository["updateInvoiceStatus"]>[2]
  >["rawPayload"];
}
