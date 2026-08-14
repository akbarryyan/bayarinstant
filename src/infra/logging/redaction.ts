import "server-only";

/**
 * Redaksi rahasia — WHUZPAY_CONSTITUTION pasal 9.2.
 *
 * Dua lapis:
 *  1. `redactOptions` dipakai pino lewat opsi `redact` — cepat, untuk bentuk
 *     yang sudah diketahui.
 *  2. `scrubDeep()` dipasang di `formatters.log` — rekursif, untuk payload
 *     provider/gateway yang bentuknya tidak bisa diprediksi.
 *
 * Keduanya HANYA menyentuh binding object. String `msg` tidak pernah
 * diredaksi, jadi aturan wajib saat memanggil logger: jangan interpolasi data
 * ke dalam pesan — pindahkan ke argumen objek pertama.
 */

export const REDACTED = "[Redacted]";

export const redactOptions = {
  censor: REDACTED,
  paths: [
    // ── kredensial umum ────────────────────────────────────────────────────
    "password",
    "*.password",
    "passwordHash",
    "*.passwordHash",
    "currentPassword",
    "*.currentPassword",
    "newPassword",
    "*.newPassword",

    // ── token akses guest order (pasal 4.2) ────────────────────────────────
    "viewToken",
    "*.viewToken",
    "view_token",
    "*.view_token",
    "viewTokenHash",
    "*.viewTokenHash",

    // ── Poppay ─────────────────────────────────────────────────────────────
    "access_token",
    "*.access_token",
    "accessToken",
    "*.accessToken",
    "integratorToken",
    "*.integratorToken",
    "secretKey",
    "*.secretKey",
    "secret",
    "*.secret",
    "POPPAY_SECRET_KEY",
    "POPPAY_INTEGRATOR_TOKEN",
    "POPPAY_PASSWORD",

    // ── header ─────────────────────────────────────────────────────────────
    "headers.authorization",
    "headers.Authorization",
    "headers.Nrt",
    "headers.cookie",
    "headers.Cookie",
    "req.headers.authorization",
    "res.headers.Nrt",

    // ── provider VIP / Digiflazz ───────────────────────────────────────────
    // `key` HANYA diredaksi di bawah payload/body/request. Jangan pernah
    // memasukkan "key" polos: itu nama field sah di SiteConfig.key,
    // PaymentMethod.key, dan Product.inputFields[].key.
    "payload.key",
    "body.key",
    "request.key",
    "req.body.key",
    "sign",
    "*.sign",
    "signature",
    "*.signature",
    "apiKey",
    "*.apiKey",
    "api_key",
    "*.api_key",

    // ── env ────────────────────────────────────────────────────────────────
    "env.SESSION_SECRET",
    "env.DATABASE_URL",
    "env.SMTP_PASS",
    "env.FONNTE_TOKEN",
    "env.DIGIFLAZZ_API_KEY",
    "env.VIP_API_KEY",

    // ── OTP ────────────────────────────────────────────────────────────────
    "otp",
    "otpCode",
    "*.otpCode",
  ],
};

/**
 * Nama key yang selalu diredaksi di kedalaman berapa pun.
 * Sengaja TIDAK memuat "key" — lihat catatan di redactOptions.paths.
 */
const DENIED_KEYS = new Set([
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "smtppass",
  "smtp_pass",
  "viewtoken",
  "view_token",
  "viewtokenhash",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "integratortoken",
  "poppay_integrator_token",
  "poppay_secret_key",
  "poppay_password",
  "nrt",
  "secret",
  "secretkey",
  "secret_key",
  "sessionsecret",
  "session_secret",
  "apikey",
  "api_key",
  "digiflazz_api_key",
  "vip_api_key",
  "fonnte_token",
  "sign",
  "signature",
  "authorization",
  "cookie",
  "set-cookie",
  "otpcode",
  "databaseurl",
  "database_url",
]);

const MAX_DEPTH = 6;

/**
 * Scrubber rekursif. Fungsi murni — sengaja dibuat begitu supaya bisa dipakai
 * ulang di luar logging, mis. sebelum menyimpan ProviderLog.request ke DB.
 */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error || value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = DENIED_KEYS.has(key.toLowerCase())
      ? REDACTED
      : scrubDeep(nested, depth + 1);
  }
  return out as unknown as T;
}

/** Mask nomor rekening/kartu: sisakan 4 digit terakhir. */
export function maskAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}
