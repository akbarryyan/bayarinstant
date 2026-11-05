// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reproduksi bug yang membanjiri log produksi: membuka /seller/<slug> memicu
 * GET /api/catalog/sellers/<slug>/products berulang-ulang, berjarak sekitar
 * satu waktu bolak-balik fetch.
 *
 * Halaman ini menaruh objek dari `useToast()` di dependency array efek yang
 * memuat data. Objek itu dibuat ulang setiap render, jadi efeknya jalan lagi
 * setiap kali ia memanggil setState — dan ia selalu memanggil setState.
 */

vi.mock("@/lib/fonts", () => ({
  Quicksand: () => ({ className: "" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/components/AppHeader", () => ({ default: () => null }));
vi.mock("@/components/BottomNavigation", () => ({ default: () => null }));
vi.mock("@/components/ui/Toast", () => ({ ToastContainer: () => null }));

const SellerStorefrontPage = (await import("@/app/seller/[slug]/page")).default;

const SLUG = "toko-voucher-digital-termurah";

function settle(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("/seller/[slug]", () => {
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls.push(String(url));
      // Sedikit jeda supaya perulangan yang salah terukur sebagai beberapa
      // panggilan, bukan sebagai lonjakan CPU yang tak terhingga.
      await settle(5);
      return {
        json: async () => ({
          success: true,
          seller: { displayName: "Toko Voucher", slug: SLUG },
          data: [],
        }),
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("memuat katalog merchant tepat satu kali", async () => {
    render(<SellerStorefrontPage params={Promise.resolve({ slug: SLUG })} />);

    await settle(250);

    expect(fetchCalls).toEqual([`/api/catalog/sellers/${SLUG}/products`]);
  });

  it("tidak memuat ulang berkali-kali saat permintaan gagal", async () => {
    // Jalur gagal memanggil toast.error(), yang mengubah state toast. Kalau
    // efeknya masih bergantung pada objek toast, justru inilah yang berputar
    // paling cepat.
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls.push(String(url));
      await settle(5);
      return { json: async () => ({ success: false, error: "Toko tidak ditemukan" }) };
    });

    render(<SellerStorefrontPage params={Promise.resolve({ slug: SLUG })} />);

    await settle(250);

    expect(fetchCalls).toHaveLength(1);
  });
});
