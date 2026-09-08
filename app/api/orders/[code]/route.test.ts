import { NextRequest } from "next/server";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/orders/[code]` mengembalikan detail lengkap kepada siapa pun yang
 * tahu kode ordernya. Kode itu berpola `WP-YYMMDD-` + 6 hex dan endpoint-nya
 * tidak dibatasi laju, jadi menebaknya murah.
 *
 * Yang bocor bukan cuma privasi: `serialNumber` adalah barang yang dibeli
 * (voucher/token), dan `paymentNumber` adalah string QRIS-nya. `targetNumber`
 * adalah nomor HP atau ID game pelanggan.
 *
 * Lookup pakai kode saja tetap dipertahankan karena itu fitur "lacak pesanan"
 * untuk guest — tetapi tanpa token atau sesi pemilik, isinya diredaksi.
 */

const ORDER_CODE = "WP-260908-ABC123";
const VIEW_TOKEN = "a".repeat(64);
const VIEW_TOKEN_HASH = crypto.createHash("sha256").update(VIEW_TOKEN).digest("hex");

let orderRow: Record<string, unknown> | null = null;
let session: Record<string, unknown> = {};

vi.mock("@/src/infra/db/prisma", () => ({
  prisma: {
    order: { findUnique: async () => orderRow },
  },
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => session,
}));

vi.mock("@/src/core/services/order/sync-expired-orders.service", () => ({
  syncExpiredOrderByCode: async () => {},
}));

vi.mock("@/src/core/services/provider/reconcile-scheduler.service", () => ({
  autoReconcileOrderNow: async () => null,
}));

const { GET } = await import("@/app/api/orders/[code]/route");

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    orderCode: ORDER_CODE,
    userId: null,
    status: "SUCCESS",
    paymentMethod: "PAYMENT_GATEWAY",
    amount: 50000,
    basePrice: 45000,
    markup: 5000,
    fee: 0,
    notes: "Provider error: saldo tidak cukup",
    serialNumber: "SN-RAHASIA-12345",
    targetNumber: "6281234567890",
    targetData: { zone: "2001" },
    viewTokenHash: VIEW_TOKEN_HASH,
    createdAt: new Date("2026-09-08T03:00:00Z"),
    updatedAt: new Date("2026-09-08T03:05:00Z"),
    product: { name: "Mobile Legends 100 Diamond", category: "games", brand: "mobile-legends" },
    paymentInvoice: {
      status: "PAID",
      method: "qris",
      paymentUrl: "https://poppay.test/checkout/xyz",
      paymentNumber: "00020101021226670016COM.RAHASIA.QRIS",
      expiredAt: null,
      paidAt: new Date("2026-09-08T03:04:00Z"),
    },
    ...overrides,
  };
}

async function get(query = "") {
  const response = await GET(
    new NextRequest(`https://example.test/api/orders/${ORDER_CODE}${query}`),
    { params: Promise.resolve({ code: ORDER_CODE }) }
  );
  return { response, body: await response.json() };
}

describe("GET /api/orders/[code] — akses tanpa token", () => {
  beforeEach(() => {
    orderRow = makeOrder();
    session = {};
  });

  it("tidak membocorkan serial number barang yang dibeli", async () => {
    const { body } = await get();

    expect(body.success).toBe(true);
    expect(body.data.serialNumber).toBeNull();
  });

  it("tidak membocorkan kredensial pembayaran", async () => {
    const { body } = await get();

    expect(body.data.paymentInvoice.paymentNumber).toBeNull();
    expect(body.data.paymentInvoice.paymentUrl).toBeNull();
  });

  it("menyamarkan nomor tujuan pelanggan", async () => {
    const { body } = await get();

    expect(body.data.targetNumber).not.toBe("6281234567890");
    expect(body.data.targetNumber).toContain("890");
    expect(body.data.targetData).toBeNull();
  });

  it("tidak membocorkan harga modal dan margin", async () => {
    const { body } = await get();

    expect(body.data.basePrice).toBeUndefined();
    expect(body.data.markup).toBeUndefined();
  });

  it("menandai respons sebagai terredaksi", async () => {
    const { body } = await get();

    expect(body.data.redacted).toBe(true);
  });

  it("tetap memberi informasi yang dibutuhkan untuk melacak pesanan", async () => {
    const { body } = await get();

    expect(body.data.orderCode).toBe(ORDER_CODE);
    expect(body.data.status).toBe("SUCCESS");
    expect(body.data.product.name).toBe("Mobile Legends 100 Diamond");
    expect(body.data.amount).toBe(50000);
    expect(body.data.createdAt).toBeTruthy();
  });
});

describe("GET /api/orders/[code] — akses yang berhak", () => {
  beforeEach(() => {
    orderRow = makeOrder();
    session = {};
  });

  it("memberi detail penuh kepada pemegang view token", async () => {
    const { body } = await get(`?token=${VIEW_TOKEN}`);

    expect(body.data.serialNumber).toBe("SN-RAHASIA-12345");
    expect(body.data.targetNumber).toBe("6281234567890");
    expect(body.data.paymentInvoice.paymentNumber).toBeTruthy();
    expect(body.data.redacted).toBe(false);
  });

  it("memberi detail penuh kepada pemilik order yang sedang login", async () => {
    orderRow = makeOrder({ userId: "user_1" });
    session = { isLoggedIn: true, userId: "user_1", role: "MEMBER" };

    const { body } = await get();

    expect(body.data.serialNumber).toBe("SN-RAHASIA-12345");
    expect(body.data.redacted).toBe(false);
  });

  it("memberi detail penuh kepada admin", async () => {
    orderRow = makeOrder({ userId: "user_1" });
    session = { isLoggedIn: true, userId: "admin_1", role: "ADMIN" };

    const { body } = await get();

    expect(body.data.serialNumber).toBe("SN-RAHASIA-12345");
    expect(body.data.redacted).toBe(false);
  });

  it("meredaksi untuk member lain yang bukan pemilik", async () => {
    orderRow = makeOrder({ userId: "user_1" });
    session = { isLoggedIn: true, userId: "user_lain", role: "MEMBER" };

    const { body } = await get();

    expect(body.data.serialNumber).toBeNull();
    expect(body.data.redacted).toBe(true);
  });

  it("menolak token yang salah alih-alih meredaksi diam-diam", async () => {
    const { response } = await get(`?token=${"b".repeat(64)}`);

    expect(response.status).toBe(403);
  });
});
