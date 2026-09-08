import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POPPAY_WEBHOOK_SIGNATURE_REQUIRED` selama ini hanya dekorasi: saat aktif dan
 * signature-nya salah, route tetap meneruskan callback ke handler. Flag yang
 * tidak menegakkan apa pun lebih berbahaya daripada tidak ada flag, karena ia
 * memberi rasa aman yang keliru.
 *
 * Saat flag mati, perilaku longgar sengaja dipertahankan — skema signature
 * Poppay masih ditebak dari sembilan kandidat, jadi menolak secara default
 * berisiko memutus seluruh callback yang sah.
 */

const config: Record<string, string> = {};
const handleCalls: unknown[] = [];

vi.mock("@/lib/site-config", () => ({
  getSiteConfigValue: async (key: string, fallback = "") => config[key] ?? fallback,
}));

vi.mock("@/lib/poppay-callback", () => ({
  handlePoppayCallback: async (payload: unknown) => {
    handleCalls.push(payload);
    return { duplicate: false, action: "completed_order" };
  },
}));

const { POST } = await import("@/app/api/webhook/poppay/route");

const SECRET = "poppay-secret";
const PAYLOAD = { refid: "POP-REF-1", agg_refid: "WP-260908-XYZ789", amount: 50000, status: 5 };
const BODY = JSON.stringify(PAYLOAD);

function post(headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("https://example.test/api/webhook/poppay", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: BODY,
    })
  );
}

function validSignature(): string {
  return crypto.createHmac("sha256", SECRET).update(BODY.trim()).digest("hex");
}

describe("POST /api/webhook/poppay — penegakan signature", () => {
  beforeEach(() => {
    handleCalls.length = 0;
    for (const key of Object.keys(config)) delete config[key];
    config.POPPAY_SECRET_KEY = SECRET;
  });

  it("menolak callback tanpa signature saat verifikasi diwajibkan", async () => {
    config.POPPAY_WEBHOOK_SIGNATURE_REQUIRED = "true";

    await post();

    expect(handleCalls).toHaveLength(0);
  });

  it("menolak signature yang tidak cocok saat verifikasi diwajibkan", async () => {
    config.POPPAY_WEBHOOK_SIGNATURE_REQUIRED = "true";

    await post({ "x-signature": "0".repeat(64) });

    expect(handleCalls).toHaveLength(0);
  });

  it("meneruskan callback dengan signature yang sah", async () => {
    config.POPPAY_WEBHOOK_SIGNATURE_REQUIRED = "true";

    await post({ "x-signature": validSignature() });

    expect(handleCalls).toHaveLength(1);
  });

  it("tetap meneruskan callback saat verifikasi belum diwajibkan", async () => {
    config.POPPAY_WEBHOOK_SIGNATURE_REQUIRED = "";

    await post();

    expect(handleCalls).toHaveLength(1);
  });

  it("tetap membalas 200 saat callback ditolak, agar Poppay tidak menganggap endpoint mati", async () => {
    config.POPPAY_WEBHOOK_SIGNATURE_REQUIRED = "true";

    const response = await post({ "x-signature": "0".repeat(64) });

    expect(response.status).toBe(200);
  });
});
