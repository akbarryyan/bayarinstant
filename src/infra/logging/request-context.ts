import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Konteks yang mengikat seluruh log dalam satu HTTP request.
 *
 * Store-nya sengaja MUTABLE: `userId` baru diketahui setelah getSession(),
 * dan `orderId`/`provider`/`paymentMethod` baru diketahui di tengah handler.
 * Dengan objek mutable, nilai-nilai itu tetap ikut di baris access log yang
 * ditulis paling akhir oleh withRequestLog().
 */
export interface RequestContext {
  requestId: string;
  /** Pola route (mis. "/api/orders/[code]"), bukan URL konkret. */
  route: string;
  method: string;
  userId?: string;
  // Field wajib WHUZPAY_CONSTITUTION pasal 9.1:
  orderId?: string;
  provider?: string;
  paymentMethod?: string;
}

const globalForRequestContext = globalThis as unknown as {
  __whuzRequestContext?: AsyncLocalStorage<RequestContext>;
};

/**
 * Singleton di SEMUA environment, termasuk produksi.
 *
 * Bundler memecah kode ke beberapa chunk dan modul ini dievaluasi lebih dari
 * sekali. Kalau tiap evaluasi punya AsyncLocalStorage sendiri, withRequestLog()
 * menulis ke store yang berbeda dari yang dibaca mixin() logger, dan semua
 * field konteks keluar kosong.
 */
const storage = (globalForRequestContext.__whuzRequestContext ??=
  new AsyncLocalStorage<RequestContext>());

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Melengkapi konteks request yang sedang berjalan.
 * No-op kalau dipanggil di luar request (mis. dari timer background).
 */
export function setRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (!store) return;

  const target = store as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null) {
      target[key] = value;
    }
  }
}
