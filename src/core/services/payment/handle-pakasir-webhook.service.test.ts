import { beforeEach, describe, expect, it } from "vitest";

import { HandlePakasirWebhookService } from "@/src/core/services/payment/handle-pakasir-webhook.service";
import type { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import type {
  DetailPaymentResult,
  IPaymentGatewayPort,
} from "@/src/core/ports/payment-gateway.port";

/**
 * Sebuah event webhook hanya boleh ditandai "selesai" kalau kesimpulannya
 * memang final. Kalau callback berhenti karena sesuatu yang bisa berubah —
 * order belum terlihat di DB, gateway belum menyelesaikan settlement — maka
 * menandainya selesai berarti membuang satu-satunya kesempatan retry.
 */

const ORDER_CODE = "WP-260908-ABC123";

const PAYLOAD = {
  order_id: ORDER_CODE,
  status: "completed",
  amount: 50000,
};

interface MarkCall {
  eventId: string;
  error?: string;
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    orderCode: ORDER_CODE,
    userId: null, // guest — menghindari jalur tier/wallet yang menyentuh DB
    status: "WAITING_PAYMENT",
    paymentMethod: "PAYMENT_GATEWAY",
    provider: "DIGIFLAZZ",
    amount: 50000,
    targetNumber: "6281234567890",
    targetData: {},
    providerRef: null,
    product: {
      id: "product_1",
      name: "Mobile Legends 100 Diamond",
      providerCode: "ML100",
      type: "game",
    },
    paymentInvoice: { invoiceId: "INV-1", status: "PENDING" },
    ...overrides,
  };
}

function makeRepo(order: ReturnType<typeof makeOrder> | null) {
  const markCalls: MarkCall[] = [];
  const events = new Map<string, { processed: boolean }>();
  let current = order;

  const repo = {
    markCalls,

    async findOrCreateWebhookEvent({ eventId }: { eventId: string }) {
      const existing = events.get(eventId);
      if (existing?.processed) return { event: existing, duplicate: true };
      if (existing) return { event: existing, duplicate: false };
      const event = { processed: false };
      events.set(eventId, event);
      return { event, duplicate: false };
    },

    async markWebhookProcessed(eventId: string, error?: string) {
      markCalls.push({ eventId, error });
      const event = events.get(eventId);
      if (event) event.processed = !error;
      return event;
    },

    async findByCode() {
      return current;
    },

    async findById() {
      return current;
    },

    async updateStatus(_id: string, status: string) {
      if (current) current = { ...current, status };
      return current;
    },

    async claimForProcessing() {
      if (!current) return false;
      if (current.status !== "PAID" && current.status !== "CREATED") return false;
      current = { ...current, status: "PROCESSING_PROVIDER" };
      return true;
    },

    async updateInvoiceStatus() {},
    async logProviderAction() {},
    async creditSellerCommission() {
      return null;
    },

    get order() {
      return current;
    },
  };

  return repo;
}

function makeGateway(status: DetailPaymentResult["status"]): IPaymentGatewayPort {
  return {
    gatewayName: "PAKASIR",
    async createPayment() {
      throw new Error("not used in this test");
    },
    async detailPayment(orderId: string): Promise<DetailPaymentResult> {
      return {
        invoiceId: "INV-1",
        orderId,
        status,
        amount: 50000,
        fee: 0,
        totalPayment: 50000,
        raw: {},
      };
    },
    async cancelPayment() {},
    async simulatePayment() {},
  };
}

describe("HandlePakasirWebhookService — event yang boleh dicoba ulang", () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo(makeOrder());
  });

  it("membiarkan event bisa diulang saat order belum ditemukan", async () => {
    const emptyRepo = makeRepo(null);
    const service = new HandlePakasirWebhookService(
      emptyRepo as unknown as OrderRepository,
      makeGateway("completed")
    );

    await service.handle(PAYLOAD, JSON.stringify(PAYLOAD));

    // Callback bisa saja mendahului commit order. Kalau ditandai selesai,
    // retry berikutnya ditolak dan order itu tidak pernah jadi PAID.
    expect(emptyRepo.markCalls.at(-1)?.error).toBeTruthy();
  });

  it("membiarkan event bisa diulang saat cross-check gateway belum completed", async () => {
    const service = new HandlePakasirWebhookService(
      repo as unknown as OrderRepository,
      makeGateway("pending")
    );

    await service.handle(PAYLOAD, JSON.stringify(PAYLOAD));

    expect(repo.markCalls.at(-1)?.error).toBeTruthy();
    expect(repo.order?.status).toBe("WAITING_PAYMENT");
  });

  it("menandai event selesai saat pembayaran benar-benar terkonfirmasi", async () => {
    const service = new HandlePakasirWebhookService(
      repo as unknown as OrderRepository,
      makeGateway("completed")
    );

    const result = await service.handle(PAYLOAD, JSON.stringify(PAYLOAD));

    expect(result.action).toBe("executed");
    expect(repo.markCalls.at(-1)?.error).toBeUndefined();
    expect(repo.order?.status).toBe("SUCCESS");
  });

  it("mengabaikan notifikasi berstatus non-completed tanpa membuka retry", async () => {
    const service = new HandlePakasirWebhookService(
      repo as unknown as OrderRepository,
      makeGateway("completed")
    );

    const payload = { ...PAYLOAD, status: "expired" };
    await service.handle(payload, JSON.stringify(payload));

    // Ini kesimpulan final dari sisi gateway — tidak ada yang perlu diulang.
    expect(repo.markCalls.at(-1)?.error).toBeUndefined();
  });

  it("memproses ulang callback yang percobaan sebelumnya gagal", async () => {
    const flaky = makeGateway("completed");
    let firstCall = true;
    flaky.detailPayment = async (orderId: string) => {
      if (firstCall) {
        firstCall = false;
        throw new Error("socket hang up");
      }
      return {
        invoiceId: "INV-1",
        orderId,
        status: "completed" as const,
        amount: 50000,
        fee: 0,
        totalPayment: 50000,
        raw: {},
      };
    };

    const service = new HandlePakasirWebhookService(
      repo as unknown as OrderRepository,
      flaky
    );

    await expect(
      service.handle(PAYLOAD, JSON.stringify(PAYLOAD))
    ).rejects.toThrow(/socket hang up/);

    // Retry dari Pakasir dengan payload identik harus benar-benar jalan.
    const retry = await service.handle(PAYLOAD, JSON.stringify(PAYLOAD));

    expect(retry.action).toBe("executed");
    expect(repo.order?.status).toBe("SUCCESS");
  });
});
