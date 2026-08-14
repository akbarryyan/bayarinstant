import {
  CreatePaymentInput,
  CreatePaymentResult,
  DetailPaymentResult,
  IPaymentGatewayPort,
} from "@/src/core/ports/payment-gateway.port";
import { calculatePaymentGatewayFee } from "@/lib/payment-gateway-fee";
import { getPaymentGatewayFeeConfig, getSiteName } from "@/lib/site-config";
import { PoppayClient } from "@/src/infra/payment/poppay/poppay.client";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("payment.poppay", { module: "adapter" });

export class PoppayAdapter implements IPaymentGatewayPort {
  gatewayName = "POPPAY";

  constructor(private readonly client = new PoppayClient()) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const siteName = await getSiteName();
    const feeConfig = await getPaymentGatewayFeeConfig(input.method ?? "qris");
    const fee = calculatePaymentGatewayFee(input.method ?? "qris", input.amount, feeConfig);
    const incoming = await this.client.createIncoming({
      aggRefId: input.orderId,
      amount: input.amount,
      notes: input.orderId,
      payorName: input.payerName?.trim() || `${siteName} Customer`,
      payorEmail: input.payerEmail?.trim() || null,
      callbackUrl: this.resolveCallbackUrl(),
      expirationInterval: 30,
    });

    return {
      invoiceId: incoming.refId,
      paymentUrl: incoming.checkoutUrl,
      paymentNumber: incoming.rawQr,
      method: "qris",
      amount: input.amount,
      fee,
      totalPayment: input.amount + fee,
      expiredAt: incoming.expiredAt ? new Date(incoming.expiredAt) : undefined,
      raw: incoming,
    };
  }

  async detailPayment(orderId: string, amount: number): Promise<DetailPaymentResult> {
    const feeConfig = await getPaymentGatewayFeeConfig("qris");
    const fee = calculatePaymentGatewayFee("qris", amount, feeConfig);
    const inquiry = await this.client.inquireIncoming(orderId);
    return {
      invoiceId: orderId,
      orderId,
      status:
        inquiry.status === "unknown"
          ? "pending"
          : inquiry.status,
      amount,
      fee,
      totalPayment: amount + fee,
      method: "qris",
      raw: inquiry.raw,
    };
  }

  async cancelPayment(orderId: string, amount: number): Promise<void> {
    void orderId;
    void amount;
    // Poppay cancel endpoint belum tersedia di docs yang diberikan.
  }

  async simulatePayment(): Promise<void> {
    throw new Error("simulatePayment tidak didukung untuk Poppay.");
  }

  /**
   * URL callback dikirim per-transaksi ke Poppay, bukan didaftarkan di
   * dashboard mereka. Kalau nilainya null, Poppay tidak punya alamat untuk
   * memanggil balik dan pembayaran tidak akan pernah terkonfirmasi — dulu
   * kegagalan ini sepenuhnya senyap.
   *
   * Catatan: `??` hanya jatuh ke fallback pada null/undefined, jadi variabel
   * yang diset tapi kosong akan "menang" dan mematikan callback. Karena itu
   * dipakai pencarian eksplisit yang juga menolak string kosong, dan sumber
   * yang terpilih ikut dilog — kalau produksi diam-diam memakai nilai dev,
   * baris log itu yang membongkarnya.
   */
  private resolveCallbackUrl(): string | null {
    const candidates = [
      ["NEXT_PUBLIC_BASE_URL", process.env.NEXT_PUBLIC_BASE_URL],
      ["NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL],
      ["APP_URL", process.env.APP_URL],
    ] as const;

    const resolved = candidates.find(([, value]) => Boolean(value?.trim()));

    if (!resolved) {
      log.error(
        { checkedEnv: candidates.map(([name]) => name) },
        "poppay callback url unresolved — gateway will not call back"
      );
      return null;
    }

    const [source, value] = resolved;
    const callbackUrl = `${value!.trim().replace(/\/+$/, "")}/api/webhook/poppay`;
    log.info({ callbackUrl, source }, "poppay callback url resolved");
    return callbackUrl;
  }
}
