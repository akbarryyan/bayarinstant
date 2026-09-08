import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gerbang idempotency webhook.
 *
 * Aturannya sederhana tapi menentukan uang: sebuah event hanya boleh menutup
 * pintu untuk retry KALAU pemrosesan sebelumnya benar-benar selesai. Kalau
 * percobaan pertama mati di tengah jalan (gateway timeout, DB lepas), retry
 * dari payment gateway adalah satu-satunya kesempatan order itu sembuh.
 *
 * Prisma di-mock di level modul karena yang diuji adalah keputusan
 * repository, bukan MySQL. Tabel webhook_events dimodelkan sebagai Map dengan
 * unique constraint pada eventId — sama seperti schema-nya.
 */

interface WebhookEventRow {
  id: string;
  source: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  processed: boolean;
  processedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

const table = new Map<string, WebhookEventRow>();

vi.mock("@/src/infra/db/prisma", () => ({
  prisma: {
    webhookEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        table.get(where.eventId) ?? null,

      create: async ({ data }: { data: Partial<WebhookEventRow> }) => {
        if (table.has(data.eventId!)) {
          throw new Error("Unique constraint failed on the fields: (`eventId`)");
        }
        const row: WebhookEventRow = {
          id: `evt_${table.size + 1}`,
          source: data.source!,
          eventId: data.eventId!,
          eventType: data.eventType!,
          payload: data.payload,
          processed: data.processed ?? false,
          processedAt: null,
          errorMessage: null,
          createdAt: new Date(),
        };
        table.set(row.eventId, row);
        return row;
      },

      update: async ({
        where,
        data,
      }: {
        where: { eventId: string };
        data: Partial<WebhookEventRow>;
      }) => {
        const row = table.get(where.eventId);
        if (!row) throw new Error("Record to update not found.");
        const updated = { ...row, ...data };
        table.set(where.eventId, updated);
        return updated;
      },
    },
  },
}));

const { OrderRepository } = await import("@/src/infra/db/repositories/order.repository");

const EVENT = {
  source: "PAKASIR",
  eventId: "pakasir:WP-260908-ABC123:completed",
  eventType: "completed",
  payload: { order_id: "WP-260908-ABC123", status: "completed" },
};

describe("OrderRepository — gerbang idempotency webhook", () => {
  let repo: InstanceType<typeof OrderRepository>;

  beforeEach(() => {
    table.clear();
    repo = new OrderRepository();
  });

  it("menerima event yang belum pernah dilihat", async () => {
    const { duplicate } = await repo.findOrCreateWebhookEvent(EVENT);

    expect(duplicate).toBe(false);
  });

  it("memproses ulang event yang percobaan sebelumnya gagal", async () => {
    // Percobaan pertama: event tercatat, lalu pemrosesan gagal di tengah jalan.
    await repo.findOrCreateWebhookEvent(EVENT);
    await repo.markWebhookProcessed(EVENT.eventId, "detailPayment failed: socket hang up");

    // Gateway retry dengan payload identik. Ini kesempatan terakhir order itu
    // sembuh — kalau ditolak di sini, customer sudah bayar tapi order mati.
    const { duplicate } = await repo.findOrCreateWebhookEvent(EVENT);

    expect(duplicate).toBe(false);
  });

  it("membuang event yang sudah selesai diproses", async () => {
    await repo.findOrCreateWebhookEvent(EVENT);
    await repo.markWebhookProcessed(EVENT.eventId);

    const { duplicate } = await repo.findOrCreateWebhookEvent(EVENT);

    expect(duplicate).toBe(true);
  });

  it("membersihkan errorMessage lama saat event gagal diproses ulang", async () => {
    await repo.findOrCreateWebhookEvent(EVENT);
    await repo.markWebhookProcessed(EVENT.eventId, "detailPayment failed: socket hang up");

    const { event } = await repo.findOrCreateWebhookEvent(EVENT);

    expect(event.errorMessage).toBeNull();
  });

  it("tidak membuat baris kedua untuk eventId yang sama", async () => {
    await repo.findOrCreateWebhookEvent(EVENT);
    await repo.markWebhookProcessed(EVENT.eventId, "boom");
    await repo.findOrCreateWebhookEvent(EVENT);

    expect(table.size).toBe(1);
  });
});
