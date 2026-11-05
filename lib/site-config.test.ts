import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kredensial Poppay harus tersimpan terenkripsi di tabel site_configs, tetapi
 * tetap terbaca sebagai teks asli oleh kode server yang memakainya.
 */

let rows: Record<string, string> = {};

vi.mock("@/src/infra/db/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: async () => Object.entries(rows).map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        rows[where.key] = create.value;
      },
      deleteMany: async () => {},
    },
  },
}));
vi.mock("@/src/infra/logging/logger", () => ({
  createLogger: () => ({ error: () => {}, info: () => {}, warn: () => {} }),
}));

const { getAllSiteConfig, getSiteConfig, invalidateSiteConfigCache, setSiteConfig } = await import("@/lib/site-config");

describe("site-config — enkripsi kunci rahasia", () => {
  beforeEach(() => {
    rows = {};
    invalidateSiteConfigCache();
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("menyimpan kunci rahasia terenkripsi di database, tetapi membacanya sebagai teks asli", async () => {
    await setSiteConfig("POPPAY_SECRET_KEY", "sec-RAHASIA");

    expect(rows.POPPAY_SECRET_KEY).toMatch(/^enc:v1:/);
    expect(rows.POPPAY_SECRET_KEY).not.toContain("RAHASIA");
    expect(await getSiteConfig("POPPAY_SECRET_KEY")).toBe("sec-RAHASIA");
  });

  it("tidak mengenkripsi kunci biasa", async () => {
    await setSiteConfig("POPPAY_EMAIL", "toko@example.com");
    expect(rows.POPPAY_EMAIL).toBe("toko@example.com");
  });

  it("menolak menyimpan kunci rahasia bila CONFIG_ENCRYPTION_KEY belum diset (tidak jatuh ke teks biasa)", async () => {
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", "");
    await expect(setSiteConfig("POPPAY_PASSWORD", "pw")).rejects.toThrow(/CONFIG_ENCRYPTION_KEY/);
    expect(rows.POPPAY_PASSWORD).toBeUndefined();
  });

  it("tetap membaca nilai lama yang masih teks biasa", async () => {
    rows.POPPAY_INTEGRATOR_TOKEN = "token-lama";
    expect(await getSiteConfig("POPPAY_INTEGRATOR_TOKEN")).toBe("token-lama");
  });

  it("kunci salah: kunci rahasia dianggap belum diisi, konfigurasi lain tetap terbaca", async () => {
    await setSiteConfig("POPPAY_SECRET_KEY", "sec");
    rows.site_name = "Toko";
    invalidateSiteConfigCache();
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));

    const all = await getAllSiteConfig();
    expect(all).not.toHaveProperty("POPPAY_SECRET_KEY");
    expect(all.site_name).toBe("Toko");
  });
});
