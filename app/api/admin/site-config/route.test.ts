import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/admin/site-config` dipakai halaman Pengaturan. Input token/password
 * di sana `type="password"`, tapi itu hanya menyamarkan tampilan: kalau
 * response JSON memuat nilai aslinya, siapa pun yang membuka tab Network (atau
 * tombol "Show") bisa membacanya. Nilai itu tidak boleh sampai ke browser —
 * termasuk yang berasal dari fallback `.env`.
 */

const SECRET_KEYS = ["POPPAY_INTEGRATOR_TOKEN", "POPPAY_SECRET_KEY", "POPPAY_PASSWORD"] as const;

let dbConfig: Record<string, string> = {};

vi.mock("@/lib/admin-guard", () => ({ requireAdmin: async () => null }));
vi.mock("@/src/infra/logging/with-request-log", () => ({
  withRequestLog: (_name: string, handler: unknown) => handler,
}));
vi.mock("@/src/infra/providers/provider.factory", () => ({
  initProviderModesFromDB: async () => {},
}));
vi.mock("@/lib/site-config", () => ({
  DEFAULT_HEADER_COLOR: "#003D99",
  normalizeHexColor: (v: string | undefined, fallback: string) => v || fallback,
  getAllSiteConfig: async () => ({ ...dbConfig }),
  getAllProviderModes: async () => ({ DIGIFLAZZ: "mock", VIP_RESELLER: "mock" }),
  setSiteConfig: async () => {},
  deleteSiteConfig: async () => {},
  invalidateSiteConfigCache: () => {},
}));

const { GET } = await import("@/app/api/admin/site-config/route");

async function fetchConfig() {
  const res = await (GET as () => Promise<Response>)();
  const text = await res.text();
  return { text, body: JSON.parse(text) };
}

describe("GET /api/admin/site-config — kunci rahasia Poppay", () => {
  beforeEach(() => {
    dbConfig = {};
    for (const key of SECRET_KEYS) vi.stubEnv(key, "");
  });

  it("tidak mengirim nilai dari database ke browser", async () => {
    dbConfig = {
      POPPAY_INTEGRATOR_TOKEN: "tok-db-RAHASIA",
      POPPAY_SECRET_KEY: "sec-db-RAHASIA",
      POPPAY_PASSWORD: "pw-db-RAHASIA",
      POPPAY_EMAIL: "toko@example.com",
    };

    const { text, body } = await fetchConfig();

    expect(text).not.toContain("RAHASIA");
    for (const key of SECRET_KEYS) expect(body.data.raw).not.toHaveProperty(key);
    // Field non-rahasia tetap dikirim.
    expect(body.data.raw.POPPAY_EMAIL).toBe("toko@example.com");
  });

  it("tidak memakai .env sama sekali: tidak dikirim dan tidak dihitung terisi", async () => {
    vi.stubEnv("POPPAY_INTEGRATOR_TOKEN", "tok-env-RAHASIA");
    vi.stubEnv("POPPAY_SECRET_KEY", "sec-env-RAHASIA");
    vi.stubEnv("POPPAY_PASSWORD", "pw-env-RAHASIA");

    const { text, body } = await fetchConfig();

    expect(text).not.toContain("RAHASIA");
    for (const key of SECRET_KEYS) expect(body.data.envDefaults).not.toHaveProperty(key);
    expect(Object.keys(body.data.envDefaults).filter((k) => k.startsWith("POPPAY_"))).toEqual([]);
    expect(body.data.secretsSet).toEqual({
      POPPAY_INTEGRATOR_TOKEN: false,
      POPPAY_SECRET_KEY: false,
      POPPAY_PASSWORD: false,
    });
  });

  it("melaporkan hanya status terisi atau belum, berdasarkan database", async () => {
    dbConfig = { POPPAY_INTEGRATOR_TOKEN: "dari-db" };
    vi.stubEnv("POPPAY_PASSWORD", "dari-env"); // diabaikan

    const { body } = await fetchConfig();

    expect(body.data.secretsSet).toEqual({
      POPPAY_INTEGRATOR_TOKEN: true, // dari DB
      POPPAY_SECRET_KEY: false, // tidak ada di mana pun
      POPPAY_PASSWORD: false, // .env tidak dihitung
    });
  });
});
