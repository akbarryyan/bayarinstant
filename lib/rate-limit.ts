import { NextResponse } from "next/server";

/**
 * Pembatas laju in-memory untuk endpoint yang bisa disalahgunakan: tebak
 * password, enumerasi kode order, dan spam checkout yang menerbitkan invoice
 * ke payment gateway.
 *
 * Sengaja in-memory, bukan di DB atau Redis. Proyek ini tidak memakai Redis,
 * dan menulis satu baris DB per request justru menambah beban di jalur yang
 * ingin dilindungi. Konsekuensinya harus disadari:
 *
 * - Hitungan hilang saat restart/deploy. Untuk menahan serangan otomatis yang
 *   berlangsung menit-an, ini tidak berarti banyak.
 * - Kalau pm2 dijalankan dalam mode cluster, tiap worker punya hitungan
 *   sendiri, sehingga batas efektifnya = batas x jumlah worker. Angka di
 *   RATE_LIMITS sudah dipilih cukup ketat agar tetap berguna walau begitu.
 */

export interface RateLimitRule {
  /** Jumlah permintaan yang diizinkan dalam satu jendela. */
  limit: number;
  /** Panjang jendela geser, dalam milidetik. */
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** 0 saat diizinkan; minimal 1 saat ditolak. */
  retryAfterSeconds: number;
}

interface Bucket {
  /** Waktu tiap permintaan yang masih dihitung, terurut menaik. */
  hits: number[];
  /** Kapan bucket ini tidak relevan lagi dan boleh dibuang. */
  expiresAt: number;
}

const g = globalThis as unknown as { _rateLimitBuckets?: Map<string, Bucket> };
if (!g._rateLimitBuckets) g._rateLimitBuckets = new Map();

/**
 * Pembersihan baru dijalankan setelah jumlah key melewati ambang ini, supaya
 * request normal tidak membayar penelusuran seluruh map. Key kedaluwarsa yang
 * masih tersisa di bawah ambang tidak berbahaya — jendela geser tetap
 * mengabaikannya saat dihitung.
 */
const PRUNE_THRESHOLD = 256;

/**
 * Batas atas jumlah key. Tanpa ini, banjir IP palsu akan menumbuhkan memori
 * tanpa batas dan pembatas lajunya sendiri berubah jadi celah DoS.
 */
const MAX_ENTRIES = 50_000;

function prune(now: number): void {
  const store = g._rateLimitBuckets!;
  if (store.size < PRUNE_THRESHOLD) return;

  for (const [key, bucket] of store) {
    if (bucket.expiresAt <= now) store.delete(key);
  }

  if (store.size <= MAX_ENTRIES) return;

  // Masih membeludak setelah dibersihkan: buang yang paling cepat kedaluwarsa
  // lebih dulu. Ini memang membuat penyerang bisa melupakan hitungannya
  // sendiri dengan membanjiri key, tapi kehabisan memori jauh lebih buruk.
  const byExpiry = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (const [key] of byExpiry.slice(0, store.size - MAX_ENTRIES)) {
    store.delete(key);
  }
}

/**
 * Mencatat satu permintaan untuk `key` dan memutuskan boleh atau tidak.
 *
 * Permintaan yang ditolak TIDAK ikut dicatat — kalau ikut dicatat, penyerang
 * yang terus menekan akan memperpanjang blokirnya sendiri tanpa batas dan
 * `retryAfterSeconds` tidak pernah mengecil.
 *
 * `now` disuntikkan agar bisa diuji tanpa menunggu jam sistem.
 */
export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now()
): RateLimitVerdict {
  const store = g._rateLimitBuckets!;
  prune(now);

  const windowStart = now - rule.windowMs;
  const hits = (store.get(key)?.hits ?? []).filter((at) => at > windowStart);

  if (hits.length >= rule.limit) {
    const oldest = hits[0];
    store.set(key, { hits, expiresAt: hits[hits.length - 1] + rule.windowMs });

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  store.set(key, { hits, expiresAt: now + rule.windowMs });

  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
}

/** Dipakai test untuk isolasi antar-kasus. */
export function resetRateLimits(): void {
  g._rateLimitBuckets = new Map();
}

/** Jumlah key yang sedang disimpan — untuk test dan diagnosa memori. */
export function rateLimitEntryCount(): number {
  return g._rateLimitBuckets!.size;
}

/**
 * IP klien menurut header proxy.
 *
 * Diambil dari entri PALING KANAN `x-forwarded-for`. nginx dengan
 * `proxy_add_x_forwarded_for` menambahkan IP asli di ujung kanan, sedangkan
 * entri di kiri berasal dari klien dan bisa dipalsukan — memakai yang kiri
 * membuat pembatas laju ini bisa diputar hanya dengan satu header.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Batas per endpoint. Longgar untuk pemakaian wajar, ketat untuk otomasi. */
export const RATE_LIMITS = {
  /** Tebak password pada satu akun. */
  login: { limit: 5, windowMs: 10 * 60_000 },
  /** Satu IP menyapu banyak akun sekaligus. */
  loginPerIp: { limit: 30, windowMs: 10 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  resetPassword: { limit: 5, windowMs: 15 * 60_000 },
  changePassword: { limit: 10, windowMs: 15 * 60_000 },
  /** Tiap kirim OTP menghabiskan kuota WhatsApp berbayar. */
  otpSend: { limit: 10, windowMs: 60 * 60_000 },
  otpVerify: { limit: 20, windowMs: 15 * 60_000 },
  /** Tiap checkout menerbitkan invoice ke payment gateway. */
  checkout: { limit: 15, windowMs: 5 * 60_000 },
  /**
   * Kode order bisa ditebak; ini yang membuat menebaknya mahal.
   *
   * Batasnya tidak bisa asal ketat: halaman `/akun/pesanan/[code]` memanggil
   * endpoint ini tiap 7 detik selama menunggu pembayaran, dan jendela QRIS
   * berumur 30 menit. Angka ini memberi ruang untuk tiga tab yang polling
   * sekaligus. Efeknya terhadap penyerang tetap menentukan: 30 permintaan per
   * menit berarti menyapu kode satu hari (16^6) butuh lebih dari setahun dari
   * satu IP.
   */
  orderLookup: { limit: 150, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Penjaga untuk route handler. Mengembalikan 429 kalau jatah habis, atau null
 * kalau boleh lanjut — idiom yang sama dengan `requireAdmin()`.
 *
 * Pemakaian:
 *   const denied = enforceRateLimit(req.headers, "login", RATE_LIMITS.login);
 *   if (denied) return denied;
 */
export function enforceRateLimit(
  headers: Headers,
  scope: string,
  rule: RateLimitRule,
  discriminator?: string
): NextResponse | null {
  const ip = clientIpFrom(headers);
  const key = discriminator ? `${scope}:${ip}:${discriminator}` : `${scope}:${ip}`;
  const verdict = consumeRateLimit(key, rule);

  if (verdict.allowed) return null;

  return NextResponse.json(
    {
      success: false,
      error: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.",
    },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSeconds) },
    }
  );
}
