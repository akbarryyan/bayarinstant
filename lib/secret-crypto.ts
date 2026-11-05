/**
 * lib/secret-crypto.ts
 *
 * Enkripsi nilai rahasia yang disimpan di database (AES-256-GCM).
 * Kuncinya dari env `CONFIG_ENCRYPTION_KEY` — sengaja di luar database, supaya
 * dump DB saja tidak cukup untuk membaca kredensial.
 *
 * Format tersimpan: `enc:v1:<iv>:<authTag>:<ciphertext>` (semuanya base64).
 * Nilai tanpa prefix `enc:v1:` dianggap teks biasa (data lama sebelum enkripsi).
 *
 * Buat kunci: `openssl rand -base64 32`
 */

import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // ukuran standar untuk GCM

export class MissingEncryptionKeyError extends Error {
  constructor(detail: string) {
    super(`CONFIG_ENCRYPTION_KEY ${detail}. Buat dengan: openssl rand -base64 32`);
    this.name = "MissingEncryptionKeyError";
  }
}

function loadKey(): Buffer {
  const raw = (process.env.CONFIG_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new MissingEncryptionKeyError("belum diset");

  // 64 karakter hex, atau base64 dari 32 byte.
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new MissingEncryptionKeyError(`harus 32 byte (base64 atau hex), saat ini ${key.length} byte`);
  }
  return key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Enkripsi. Melempar MissingEncryptionKeyError kalau kunci belum benar — tidak pernah jatuh ke teks biasa. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Dekripsi. Nilai tanpa prefix dikembalikan apa adanya (data lama).
 * Melempar kalau kunci salah/hilang atau data diubah (GCM memverifikasi authTag).
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Format nilai terenkripsi tidak valid");

  const decipher = createDecipheriv(ALGO, loadKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
