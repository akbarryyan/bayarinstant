import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Test runner untuk logika server (service + domain).
 *
 * Sengaja `environment: "node"` — yang dites di sini adalah alur transaksi,
 * bukan komponen React. Alias `@` dibuat manual agar cocok dengan
 * `paths` di tsconfig.json tanpa menambah dependency plugin.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` melempar error di luar RSC; di test ia hanya penghalang.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Log aplikasi dimatikan supaya kegagalan test tidak tenggelam di
    // antara baris JSON pino.
    env: {
      LOG_LEVEL: "silent",
      // Provider dipaksa mock tanpa delay supaya jalur sukses deterministik.
      MOCK_PROVIDER_SCENARIO: "success",
      MOCK_PROVIDER_DELAY_MS: "0",
    },
    include: ["src/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
