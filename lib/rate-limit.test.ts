import { beforeEach, describe, expect, it } from "vitest";

import {
  clientIpFrom,
  consumeRateLimit,
  rateLimitEntryCount,
  resetRateLimits,
} from "@/lib/rate-limit";

/**
 * Pembatas laju untuk endpoint yang bisa disalahgunakan: tebak password,
 * enumerasi kode order, dan spam checkout yang menerbitkan invoice ke gateway.
 *
 * Waktu disuntikkan sebagai argumen, bukan dibaca dari jam sistem, supaya
 * perilaku jendela bisa diuji tanpa menunggu dan tanpa fake timer.
 */

const RULE = { limit: 3, windowMs: 60_000 };
const T0 = 1_700_000_000_000;

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("mengizinkan permintaan sampai batas", () => {
    const verdicts = [0, 1, 2].map((i) => consumeRateLimit("k", RULE, T0 + i));

    expect(verdicts.every((v) => v.allowed)).toBe(true);
  });

  it("menolak permintaan berikutnya setelah batas tercapai", () => {
    for (let i = 0; i < RULE.limit; i++) consumeRateLimit("k", RULE, T0 + i);

    expect(consumeRateLimit("k", RULE, T0 + 10).allowed).toBe(false);
  });

  it("menghitung sisa jatah", () => {
    expect(consumeRateLimit("k", RULE, T0).remaining).toBe(2);
    expect(consumeRateLimit("k", RULE, T0).remaining).toBe(1);
    expect(consumeRateLimit("k", RULE, T0).remaining).toBe(0);
  });

  it("mengizinkan lagi setelah jendela lewat", () => {
    for (let i = 0; i < RULE.limit; i++) consumeRateLimit("k", RULE, T0 + i);
    expect(consumeRateLimit("k", RULE, T0 + 100).allowed).toBe(false);

    expect(consumeRateLimit("k", RULE, T0 + RULE.windowMs + 1).allowed).toBe(true);
  });

  it("menggeser jendela, bukan mengosongkannya sekaligus", () => {
    // Jendela tetap (fixed window) akan mengizinkan ledakan 2x batas di
    // perbatasan; jendela geser tidak.
    consumeRateLimit("k", RULE, T0);
    consumeRateLimit("k", RULE, T0 + 59_000);
    consumeRateLimit("k", RULE, T0 + 59_500);

    // T0 sudah kedaluwarsa, dua sisanya belum → tepat satu slot bebas.
    expect(consumeRateLimit("k", RULE, T0 + 60_500).allowed).toBe(true);
    expect(consumeRateLimit("k", RULE, T0 + 60_600).allowed).toBe(false);
  });

  it("menghitung tiap key secara terpisah", () => {
    for (let i = 0; i < RULE.limit; i++) consumeRateLimit("a", RULE, T0 + i);

    expect(consumeRateLimit("a", RULE, T0 + 10).allowed).toBe(false);
    expect(consumeRateLimit("b", RULE, T0 + 10).allowed).toBe(true);
  });

  it("melaporkan berapa detik lagi boleh mencoba", () => {
    for (let i = 0; i < RULE.limit; i++) consumeRateLimit("k", RULE, T0);

    const verdict = consumeRateLimit("k", RULE, T0 + 20_000);

    // Percobaan tertua kedaluwarsa 40 detik lagi.
    expect(verdict.retryAfterSeconds).toBe(40);
  });

  it("selalu melaporkan minimal satu detik saat ditolak", () => {
    for (let i = 0; i < RULE.limit; i++) consumeRateLimit("k", RULE, T0);

    const verdict = consumeRateLimit("k", RULE, T0 + RULE.windowMs - 100);

    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("melupakan key yang jendelanya sudah lewat", () => {
    // Tanpa ini, satu banjir IP palsu akan menumbuhkan memori tanpa batas —
    // pembatas lajunya sendiri jadi celah DoS.
    for (let i = 0; i < 500; i++) consumeRateLimit(`ip-${i}`, RULE, T0);
    expect(rateLimitEntryCount()).toBe(500);

    consumeRateLimit("pemicu", RULE, T0 + RULE.windowMs + 1);

    expect(rateLimitEntryCount()).toBe(1);
  });
});

describe("clientIpFrom", () => {
  it("memakai entri paling kanan dari x-forwarded-for", () => {
    // nginx menambahkan IP asli di ujung kanan; entri di kiri berasal dari
    // klien dan bisa dipalsukan untuk memutar pembatas laju.
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });

    expect(clientIpFrom(headers)).toBe("3.3.3.3");
  });

  it("jatuh ke x-real-ip saat x-forwarded-for tidak ada", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("memberi nilai tetap saat tidak ada header proxy sama sekali", () => {
    expect(clientIpFrom(new Headers())).toBeTruthy();
  });
});
