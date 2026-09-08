import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMITS, resetRateLimits } from "@/lib/rate-limit";

/**
 * Login tidak punya pembatas apa pun: satu skrip bisa mencoba password
 * sebanyak yang ia mau, dan tidak ada jejak selain baris log per percobaan.
 */

let userRow: Record<string, unknown> | null = null;

vi.mock("@/src/infra/db/prisma", () => ({
  prisma: {
    user: { findUnique: async () => userRow },
  },
}));

vi.mock("@/lib/session", () => ({
  getSession: async () => ({ save: async () => {} }),
}));

vi.mock("bcryptjs", () => ({
  default: { compare: async (plain: string, hash: string) => plain === hash },
}));

const { POST } = await import("@/app/api/auth/login/route");

function login(password: string, ip = "1.2.3.4") {
  return POST(
    new NextRequest("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ identifier: "budi@example.test", password, method: "email" }),
    })
  );
}

describe("POST /api/auth/login — pembatasan laju", () => {
  beforeEach(() => {
    resetRateLimits();
    userRow = {
      id: "user_1",
      email: "budi@example.test",
      phone: "6281234567890",
      name: "Budi",
      role: "MEMBER",
      passwordHash: "rahasia-yang-benar",
      isActive: true,
    };
  });

  it("menolak percobaan setelah batas tercapai", async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      const res = await login("salahsekali");
      expect(res.status).toBe(401);
    }

    const blocked = await login("salahsekali");

    expect(blocked.status).toBe(429);
  });

  it("memberi tahu kapan boleh mencoba lagi", async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await login("salahsekali");

    const blocked = await login("salahsekali");

    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("tidak menghukum IP lain karena percobaan dari satu IP", async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await login("salahsekali", "1.2.3.4");

    const other = await login("salahsekali", "5.6.7.8");

    expect(other.status).toBe(401);
  });

  it("tidak ikut menghitung percobaan yang berhasil sampai memblokir pemilik akun", async () => {
    // Login yang benar tetap dihitung — kalau tidak, penyerang tinggal
    // menyelipkan satu login sah untuk mengosongkan jatah. Yang penting,
    // pemakaian wajar tidak sampai menyentuh batas.
    const res = await login("rahasia-yang-benar");

    expect(res.status).toBe(200);
  });

  it("membatasi satu IP yang menyapu banyak akun berbeda", async () => {
    // Batas per akun tidak menolong kalau penyerang mencoba satu password ke
    // ribuan email dari satu IP.
    let lastStatus = 0;
    for (let i = 0; i < RATE_LIMITS.loginPerIp.limit + 1; i++) {
      const res = await POST(
        new NextRequest("https://example.test/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({
            identifier: `korban${i}@example.test`,
            password: "salahsekali",
            method: "email",
          }),
        })
      );
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
