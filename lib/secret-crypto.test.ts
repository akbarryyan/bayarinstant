import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret, isEncrypted, MissingEncryptionKeyError } from "@/lib/secret-crypto";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("secret-crypto", () => {
  beforeEach(() => vi.stubEnv("CONFIG_ENCRYPTION_KEY", KEY_A));
  afterEach(() => vi.unstubAllEnvs());

  it("enkripsi lalu dekripsi mengembalikan teks asli", () => {
    const enc = encryptSecret("tok-RAHASIA-123");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("RAHASIA");
    expect(decryptSecret(enc)).toBe("tok-RAHASIA-123");
  });

  it("memakai IV acak: plaintext sama menghasilkan ciphertext berbeda", () => {
    expect(encryptSecret("sama")).not.toBe(encryptSecret("sama"));
  });

  it("menerima kunci dalam format hex 64 karakter", () => {
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("hex"));
    expect(decryptSecret(encryptSecret("hex-ok"))).toBe("hex-ok");
  });

  it("nilai lama tanpa prefix dikembalikan apa adanya", () => {
    expect(decryptSecret("teks-lama")).toBe("teks-lama");
  });

  it("menolak data yang diubah (authTag GCM)", () => {
    const enc = encryptSecret("jangan diubah");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[4], "base64");
    ct[0] ^= 0xff;
    parts[4] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("menolak dekripsi dengan kunci yang salah", () => {
    const enc = encryptSecret("rahasia");
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", KEY_B);
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("gagal tertutup bila kunci kosong atau panjangnya salah — tidak pernah teks biasa", () => {
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("x")).toThrow(MissingEncryptionKeyError);
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"));
    expect(() => encryptSecret("x")).toThrow(/32 byte/);
  });
});
