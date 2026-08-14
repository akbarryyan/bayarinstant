import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── Kebijakan logging (docs/WHUZPAY_CONSTITUTION.md §9) ───────────────────
  // Pakai createLogger() dari src/infra/logging/logger, bukan console.
  //
  // Cakupannya sengaja file .ts saja: seluruh kode server ada di .ts, dan
  // satu-satunya console.* yang sah ada di client component (.tsx) yang memang
  // TIDAK boleh mengimpor logger (server-only). Dengan begitu aturan ini
  // menangkap 100% target tanpa daftar pengecualian yang harus dirawat.
  //
  // Konsekuensi yang diterima: server component .tsx tidak tercakup. Saat ini
  // tidak ada satu pun yang memanggil console.*.
  {
    files: ["app/**/*.ts", "lib/**/*.ts", "src/**/*.ts", "middleware.ts", "instrumentation.ts"],
    ignores: [
      "src/infra/logging/**", // modul logger itu sendiri menulis ke stderr
      "prisma/**", // skrip seed dijalankan tsx di luar bundling Next
      "scripts/**",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree lokal Claude Code memuat .next hasil build sendiri; tanpa ini
    // eslint ikut memeriksa ribuan baris artefak build.
    ".claude/**",
    "logs/**",
  ]),
]);

export default eslintConfig;
