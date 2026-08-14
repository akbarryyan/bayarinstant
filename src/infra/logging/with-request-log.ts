import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createLogger } from "./logger";
import { getRequestContext, runWithRequestContext } from "./request-context";

const log = createLogger("http");

/**
 * Handler apa pun di App Router: dengan maupun tanpa context params dinamis.
 * `Args` di-infer sebagai tuple, jadi wrapper tetap cocok dengan validator
 * tipe Next (.next/types/validator.ts) tanpa cast.
 */
type RouteHandler<Args extends unknown[]> = (
  request: NextRequest,
  ...args: Args
) => Response | Promise<Response>;

/** Hanya terima request id dari luar kalau bentuknya masuk akal. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

const LOGGED_MARKER = Symbol.for("whuzpay.logged");

/** Menandai error yang sudah dilog di sini, supaya onRequestError tidak dobel. */
export function markErrorLogged(error: unknown): void {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, LOGGED_MARKER, {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // error bisa saja frozen — duplikasi log lebih baik daripada crash
    }
  }
}

export function isErrorLogged(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<symbol, unknown>)[LOGGED_MARKER]
  );
}

/**
 * Membungkus route handler dengan access log + konteks request.
 *
 * @param route Pola route (mis. "/api/orders/[code]"), BUKAN URL konkret —
 *              supaya log bisa diagregasi per-endpoint.
 */
export function withRequestLog<Args extends unknown[]>(
  route: string,
  handler: RouteHandler<Args>
): (request: NextRequest, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    const startedAt = performance.now();

    const inboundId = request.headers.get("x-request-id") ?? "";
    const requestId = SAFE_REQUEST_ID.test(inboundId) ? inboundId : randomUUID();

    const method = request.method;
    let path = route;
    try {
      path = new URL(request.url).pathname;
    } catch {
      // URL tidak valid — pakai pola route sebagai fallback
    }

    return runWithRequestContext({ requestId, route, method }, async () => {
      // Default 500: kalau handler melempar, baris access log tetap mencatat
      // status yang benar-benar dikirim Next ke klien.
      let status = 500;

      try {
        const response = await handler(request, ...args);
        status = response.status;
        try {
          response.headers.set("x-request-id", requestId);
        } catch {
          // sebagian Response punya headers immutable
        }
        return response;
      } catch (error) {
        markErrorLogged(error);
        log.error({ err: error, path }, "unhandled error in route handler");
        throw error;
      } finally {
        const context = getRequestContext();
        log.info(
          {
            path,
            status,
            durationMs: Math.round(performance.now() - startedAt),
            userId: context?.userId ?? null,
          },
          "access"
        );
      }
    });
  };
}
