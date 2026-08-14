import type { InstrumentationOnRequestError } from "next/dist/server/instrumentation/types";

/**
 * Hook inisialisasi server Next.js.
 *
 * File ini dikompilasi untuk SEMUA runtime termasuk edge, sementara modul
 * logger memakai `node:fs` dan `node:async_hooks`. Karena itu seluruh isi
 * dibungkus `if (process.env.NEXT_RUNTIME === "nodejs")` — bentuk kondisi
 * POSITIF, bukan early-return, supaya bundler bisa membuang seluruh blok
 * sebagai dead code saat mengompilasi untuk edge. Akses ke logger juga selalu
 * lewat dynamic import.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@/src/infra/logging/logger");
    const { logDirectory } = await import("@/src/infra/logging/destinations");

    // Sengaja dilog saat boot: kalau direktori log tidak bisa ditulis, kita
    // tahu sekarang — bukan saat webhook pertama gagal jam 2 pagi.
    logger.info(
      { subsystem: "boot", node: process.version, logDirectory },
      "server started"
    );

    // reconcile-scheduler.service.ts memakai setTimeout in-process; rejection
    // di dalamnya saat ini hilang total tanpa handler ini.
    process.on("unhandledRejection", (reason) => {
      logger.error({ subsystem: "process", err: reason }, "unhandled rejection");
    });

    process.on("uncaughtException", (error) => {
      logger.fatal({ subsystem: "process", err: error }, "uncaught exception");
      try {
        logger.flush();
      } catch {
        // stream bisa saja sudah rusak — jangan menutupi error aslinya
      }
      // Jangan ditelan — biarkan process manager me-restart.
      process.exit(1);
    });
  }
}

/** Jaring pengaman untuk error yang tidak lewat withRequestLog(). */
export const onRequestError: InstrumentationOnRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@/src/infra/logging/logger");
    const { isErrorLogged } = await import(
      "@/src/infra/logging/with-request-log"
    );

    // Sudah dicatat withRequestLog — jangan dobel.
    if (isErrorLogged(error)) return;

    createLogger("next").error(
      {
        err: error,
        path: request.path,
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      "request error (framework)"
    );
  }
};
