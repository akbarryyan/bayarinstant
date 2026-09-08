import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Callback Poppay berhenti di dua tempat yang bukan kesimpulan akhir:
 *
 * - `not_found`      — order/topup belum terlihat saat callback tiba.
 * - `inquiry_mismatch` — cross-check ke Poppay tidak mengonfirmasi lunas.
 *
 * Yang kedua sangat mudah terjadi tanpa ada yang salah dengan pembayarannya:
 * `confirmCompletedViaInquiry()` menurunkan SEMUA error jadi `false`, jadi satu
 * timeout jaringan sudah cukup. Kalau event-nya ditandai selesai di titik itu,
 * retry Poppay berikutnya akan dibuang sebagai duplikat dan order yang sudah
 * dibayar tidak akan pernah jalan.
 */

const ORDER_CODE = "WP-260908-XYZ789";

interface Row {
  eventId: string;
  processed: boolean;
  errorMessage: string | null;
}

const webhookEvents = new Map<string, Row>();
let orderRow: Record<string, unknown> | null = null;
let inquiryStatus: string | Error = "completed";

/**
 * Cukup permukaan Prisma yang benar-benar disentuh alur callback ini. Tabel
 * webhook_events dimodelkan sungguhan (Map + unique eventId) karena di situlah
 * perilaku yang diuji; sisanya hanya agar alur tidak menabrak `undefined`.
 */
const tables = {
  orderProviderLog: { create: async () => ({}) },
  wallet: { findUnique: async () => null },
  ledgerEntry: { findFirst: async () => null },
  webhookEvent: {
    findUnique: async ({ where }: { where: { eventId: string } }) =>
      webhookEvents.get(where.eventId) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = { eventId: data.eventId, processed: false, errorMessage: null };
      webhookEvents.set(row.eventId, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { eventId: string };
      data: Partial<Row>;
    }) => {
      const row = webhookEvents.get(where.eventId)!;
      const updated = { ...row, ...data };
      webhookEvents.set(where.eventId, updated);
      return updated;
    },
  },
  order: {
    findUnique: async () => orderRow,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      orderRow = { ...orderRow, ...data };
      return orderRow;
    },
    updateMany: async () => ({ count: 1 }),
  },
  paymentInvoice: {
    update: async () => ({}),
  },
};

/** `$transaction` cukup menjalankan callback-nya di atas tabel yang sama. */
const fakePrisma = {
  ...tables,
  $transaction: async <T>(fn: (tx: typeof tables) => Promise<T>) => fn(tables),
};

vi.mock("@/src/infra/db/prisma", () => ({ prisma: fakePrisma }));

vi.mock("@/src/infra/payment/poppay/poppay.client", () => ({
  PoppayClient: class {
    async inquireIncoming() {
      if (inquiryStatus instanceof Error) throw inquiryStatus;
      return { status: inquiryStatus, statusCode: 200 };
    }
  },
}));

const { handlePoppayCallback } = await import("@/lib/poppay-callback");

/** status 5 = lunas menurut Poppay */
const PAYLOAD = {
  refid: "POP-REF-1",
  agg_refid: ORDER_CODE,
  amount: 50000,
  status: 5,
};

function lastEvent(): Row {
  return [...webhookEvents.values()].at(-1)!;
}

describe("handlePoppayCallback — event yang boleh dicoba ulang", () => {
  beforeEach(() => {
    webhookEvents.clear();
    inquiryStatus = "completed";
    orderRow = {
      id: "order_1",
      orderCode: ORDER_CODE,
      userId: null,
      status: "WAITING_PAYMENT",
      paymentMethod: "PAYMENT_GATEWAY",
      provider: "DIGIFLAZZ",
      amount: 50000,
      targetNumber: "6281234567890",
      targetData: {},
      providerRef: null,
      product: { id: "product_1", name: "ML 100 Diamond", providerCode: "ML100", type: "game" },
      paymentInvoice: { id: "inv_1", invoiceId: "INV-1", status: "PENDING", method: "qris", paidAt: null },
    };
  });

  it("tidak menutup retry saat cross-check inquiry gagal", async () => {
    inquiryStatus = new Error("connect ETIMEDOUT");

    const result = await handlePoppayCallback(PAYLOAD, PAYLOAD);

    expect(result.action).toBe("inquiry_mismatch");
    expect(lastEvent().processed).toBe(false);
  });

  it("tidak menutup retry saat inquiry belum melaporkan lunas", async () => {
    inquiryStatus = "pending";

    const result = await handlePoppayCallback(PAYLOAD, PAYLOAD);

    expect(result.action).toBe("inquiry_mismatch");
    expect(lastEvent().processed).toBe(false);
  });

  it("tidak menutup retry saat order belum ditemukan", async () => {
    orderRow = null;

    const result = await handlePoppayCallback(PAYLOAD, PAYLOAD);

    expect(result.action).toBe("not_found");
    expect(lastEvent().processed).toBe(false);
  });

  it("memproses ulang callback yang sebelumnya gagal cross-check", async () => {
    inquiryStatus = new Error("connect ETIMEDOUT");
    await handlePoppayCallback(PAYLOAD, PAYLOAD);

    // Poppay retry dengan payload identik, kali ini jaringan sehat.
    inquiryStatus = "completed";
    const retry = await handlePoppayCallback(PAYLOAD, PAYLOAD);

    expect(retry.duplicate).toBe(false);
    expect(retry.action).toBe("completed_order");
    expect(lastEvent().processed).toBe(true);
  });

  it("menandai selesai saat pembayaran terkonfirmasi", async () => {
    const result = await handlePoppayCallback(PAYLOAD, PAYLOAD);

    expect(result.action).toBe("completed_order");
    expect(lastEvent().processed).toBe(true);
  });
});
