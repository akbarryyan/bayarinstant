import "server-only";
import pino, { type Logger } from "pino";
import { buildStreams } from "./destinations";
import { redactOptions, scrubDeep } from "./redaction";
import { getRequestContext } from "./request-context";

/**
 * Logger terstruktur — WHUZPAY_CONSTITUTION pasal 9.
 *
 * Cara pakai:
 *
 *   const log = createLogger("webhook.poppay");     // sekali per file
 *   log.info({ orderId, aggRefId }, "callback received");
 *   log.error({ err }, "callback gagal diproses");
 *
 * ATURAN INDUK: data masuk ke argumen OBJEK, bukan ke string pesan.
 * Redaksi rahasia hanya bekerja pada binding object; string `msg` tidak
 * pernah diredaksi. Pesan juga dibuat statis supaya bisa diagregasi.
 *
 *   SALAH : log.info(`order ${id} lunas`)
 *   BENAR : log.info({ orderId: id }, "order lunas")
 *
 * Field wajib pasal 9.1 (orderId, provider, paymentMethod, userId) tidak perlu
 * ditulis manual di tiap panggilan: `mixin()` menyuntikkannya otomatis dari
 * AsyncLocalStorage begitu setRequestContext() dipanggil di jalur order.
 */

/** Daftar tertutup supaya typo ketahuan compiler. */
export type Subsystem =
  // infrastruktur
  | "boot"
  | "process"
  | "next"
  | "http"
  // route API
  | "api.auth"
  | "api.admin"
  | "api.checkout"
  | "api.orders"
  | "api.wallet"
  | "api.merchant"
  | "api.seller"
  | "api.catalog"
  | "api.tickets"
  | "api.vouchers"
  | "api.misc"
  // webhook masuk
  | "webhook.poppay"
  | "webhook.pakasir"
  | "webhook.vip"
  | "webhook.legacy"
  | "wallet.topup"
  // payment gateway
  | "payment.poppay"
  | "payment.pakasir"
  // provider
  | "provider.vip"
  | "provider.digiflazz"
  | "provider.mgmt"
  // domain
  | "checkout"
  | "order.execute"
  | "order.reconcile"
  | "order.expire"
  | "pricing"
  | "seller"
  // lain-lain
  | "notify.fonnte"
  | "notify.mailer"
  | "db.repo"
  | "config"
  | "upload";

const isProduction = process.env.NODE_ENV === "production";

const level = (process.env.LOG_LEVEL ??
  (isProduction ? "info" : "debug")) as pino.Level;

// WIB tidak punya DST, jadi offset +07:00 konstan dan aman di-hardcode.
// Kontrak pino: fungsi timestamp mengembalikan string berawalan `,"time":`.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
function jakartaTimestamp(): string {
  const shifted = new Date(Date.now() + WIB_OFFSET_MS).toISOString();
  return `,"time":"${shifted.replace("Z", "+07:00")}"`;
}

const globalForLogger = globalThis as unknown as { __whuzLogger?: Logger };

function createRootLogger(): Logger {
  return pino(
    {
      level,
      timestamp: jakartaTimestamp,
      base: {
        app: "whuzpay",
        env: process.env.NODE_ENV,
        pid: process.pid,
      },
      redact: redactOptions,
      formatters: {
        // "level":"info" alih-alih "level":30 — bisa di-grep manusia.
        level: (label) => ({ level: label }),
        // Lapis kedua redaksi, untuk payload yang bentuknya tak terduga.
        log: (object) => scrubDeep(object),
      },
      serializers: {
        err: pino.stdSerializers.errWithCause,
      },
      /**
       * Menyuntikkan konteks request ke SETIAP baris log, di kedalaman mana
       * pun, tanpa mengoper parameter ke signature fungsi mana pun.
       * Objek yang dilog eksplisit menang atas nilai dari sini.
       */
      mixin() {
        const context = getRequestContext();
        if (!context) return {};
        return {
          requestId: context.requestId,
          route: context.route,
          method: context.method,
          userId: context.userId,
          orderId: context.orderId,
          provider: context.provider,
          paymentMethod: context.paymentMethod,
        };
      },
    },
    pino.multistream(buildStreams(level))
  );
}

/**
 * Singleton di SEMUA environment — beda dengan pola prisma.ts yang hanya
 * meng-cache di non-produksi. Bundler memecah kode ke beberapa chunk dan modul
 * ini terbukti dievaluasi lebih dari sekali; tanpa cache global itu berarti
 * beberapa SonicBoom menulis ke file yang sama, plus handler SIGUSR2/exit
 * berlipat.
 */
export const logger: Logger = (globalForLogger.__whuzLogger ??=
  createRootLogger());

/** Child logger per-subsistem; pengganti konvensi prefix "[Webhook/Poppay]". */
export function createLogger(
  subsystem: Subsystem,
  bindings: Record<string, unknown> = {}
): Logger {
  return logger.child({ subsystem, ...bindings });
}
