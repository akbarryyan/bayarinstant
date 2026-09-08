/**
 * Stub untuk paket `server-only`.
 *
 * Paket aslinya sengaja melempar error kalau di-import dari luar React Server
 * Component — penjaga yang benar di runtime Next.js, tapi di Vitest ia
 * memblokir modul server yang justru ingin kita uji. Alias-nya diatur di
 * vitest.config.ts.
 */
export {};
