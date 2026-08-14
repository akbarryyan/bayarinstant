import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSiteConfigValue } from "@/lib/site-config";
import { handlePoppayCallback, type PoppayCallbackPayload } from "@/lib/poppay-callback";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.poppay", { module: "route" });
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

type VerificationResult =
  | { mode: "verified" | "skipped" | "invalid"; reason?: string };

function readHeader(headers: Headers, keys: string[]): string {
  for (const key of keys) {
    const value = headers.get(key);
    if (value) return value.trim();
  }
  return "";
}

function normalizeBool(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function safeEqualHex(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.length !== normalizedRight.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedLeft, "utf8"),
      Buffer.from(normalizedRight, "utf8")
    );
  } catch {
    return false;
  }
}

function computeHmacSha256(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function computeSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function verifyPoppayWebhookSignature(
  headers: Headers,
  rawBody: string,
  payload: PoppayCallbackPayload
): Promise<VerificationResult> {
  const secret = (await getSiteConfigValue("POPPAY_SECRET_KEY")).trim();
  const signatureRequired = normalizeBool(await getSiteConfigValue("POPPAY_WEBHOOK_SIGNATURE_REQUIRED", ""));

  if (!secret) {
    if (signatureRequired) {
      return { mode: "invalid", reason: "POPPAY_SECRET_KEY belum diisi saat strict verification aktif." };
    }
    return { mode: "skipped" };
  }

  const signature = readHeader(headers, [
    "x-signature",
    "x-poppay-signature",
    "signature",
    "x-callback-signature",
  ]);
  const timestamp = readHeader(headers, [
    "x-timestamp",
    "x-poppay-timestamp",
    "timestamp",
    "x-callback-timestamp",
  ]);

  if (!signature) {
    if (signatureRequired) {
      return { mode: "invalid", reason: "Header signature callback tidak ditemukan." };
    }
    log.warn("poppay signature header missing — verification skipped");
    return { mode: "skipped" };
  }

  const compactBody = rawBody.trim();
  const baseFields = `${payload.refid}${payload.agg_refid}${payload.status}`;
  const candidates = [
    computeHmacSha256(secret, compactBody),
    computeSha256(compactBody + secret),
    computeSha256(secret + compactBody),
  ];

  if (timestamp) {
    candidates.push(
      computeHmacSha256(secret, `${baseFields}${timestamp}`),
      computeHmacSha256(secret, `${timestamp}.${compactBody}`),
      computeHmacSha256(secret, `${compactBody}${timestamp}`)
    );
  }

  candidates.push(
    computeHmacSha256(secret, baseFields),
    computeSha256(baseFields + secret),
    computeSha256(secret + baseFields)
  );

  const isValid = candidates.some((candidate) => safeEqualHex(candidate, signature));
  if (!isValid) {
    return { mode: "invalid", reason: "Signature callback Poppay tidak valid." };
  }

  return { mode: "verified" };
}

async function POST_handler(request: Request) {
  let rawBody = "";
  let payload: PoppayCallbackPayload | null = null;

  // Dicatat SEBELUM parsing apa pun. Inilah bukti "callback benar-benar
  // sampai" yang kemarin tidak kita punya.
  log.info(
    {
      contentLength: request.headers.get("content-length"),
      contentType: request.headers.get("content-type"),
      userAgent: request.headers.get("user-agent"),
      ip:
        request.headers.get("x-forwarded-for") ??
        request.headers.get("x-real-ip"),
      hasSignature: Boolean(
        request.headers.get("x-signature") ??
          request.headers.get("x-poppay-signature") ??
          request.headers.get("signature") ??
          request.headers.get("x-callback-signature")
      ),
    },
    "poppay callback received"
  );

  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody) as PoppayCallbackPayload;
  } catch {
    log.warn(
      { bodyPreview: rawBody.slice(0, 200) },
      "poppay callback ignored: invalid json"
    );
    return NextResponse.json(
      {
        status: "success",
        message: "Invalid JSON ignored",
        data: { id: "ignored-invalid-json", created_at: new Date().toISOString() },
      },
      { status: 200 }
    );
  }

  if (!payload?.refid || !payload?.agg_refid || payload?.status == null) {
    // Kalau Poppay mengubah bentuk payload, ini satu-satunya yang akan
    // memberi tahu kita. Nama key saja — bukan nilainya.
    log.warn(
      { presentKeys: Object.keys(payload ?? {}) },
      "poppay callback ignored: missing required fields"
    );
    return NextResponse.json(
      {
        status: "success",
        message: "Missing required fields ignored",
        data: { id: "ignored-missing-fields", created_at: new Date().toISOString() },
      },
      { status: 200 }
    );
  }

  // Payload yang benar-benar diterima. Dilewatkan sebagai binding object agar
  // kena redaksi — jangan pernah dimasukkan ke string pesan.
  log.info({ payload }, "poppay callback payload");

  try {
    const verification = await verifyPoppayWebhookSignature(request.headers, rawBody, payload);
    if (verification.mode === "invalid") {
      log.warn(
        { mode: verification.mode, reason: verification.reason, refId: payload.refid },
        "poppay signature check failed — continuing with inquiry cross-check"
      );
    } else {
      log.info({ mode: verification.mode }, "poppay signature check");
    }

    const result = await handlePoppayCallback(payload, JSON.parse(rawBody));
    return NextResponse.json(
      {
        status: "success",
        message: "Operation completed successfully",
        data: {
          id: payload.refid,
          created_at: new Date().toISOString(),
          verification: verification.mode,
          result,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    log.error({ err: error, refId: payload.refid, aggRefId: payload.agg_refid }, "poppay callback handler error");
    return NextResponse.json(
      {
        status: "success",
        message: "Operation completed with internal error",
        data: {
          id: payload.refid,
          created_at: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  }
}

export const POST = withRequestLog("/api/webhook/poppay", POST_handler);
