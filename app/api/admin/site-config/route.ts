/**
 * GET  /api/admin/site-config  — returns all site config values + effective provider modes
 * PATCH /api/admin/site-config — upsert one config key
 * DELETE /api/admin/site-config?key=... — reset key to env/default
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_HEADER_COLOR,
  getAllSiteConfig,
  setSiteConfig,
  deleteSiteConfig,
  getAllProviderModes,
  invalidateSiteConfigCache,
  normalizeHexColor,
} from "@/lib/site-config";
import { initProviderModesFromDB } from "@/src/infra/providers/provider.factory";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await requireAdmin();
  if (deny) return deny;

  // Sync in-memory ProviderFactory from DB on each admin page load
  await initProviderModesFromDB();

  const [raw, modes] = await Promise.all([
    getAllSiteConfig(),
    getAllProviderModes(),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      raw,          // all raw key→value pairs
      modes,        // effective resolved modes (DB > env > default)
      envDefaults: {
        PROVIDER_DIGIFLAZZ_MODE: process.env.PROVIDER_DIGIFLAZZ_MODE ?? "mock",
        PROVIDER_VIP_MODE: process.env.PROVIDER_VIP_MODE ?? "mock",
        HEADER_COLOR: normalizeHexColor(process.env.HEADER_COLOR, DEFAULT_HEADER_COLOR),
        POPPAY_API_BASE_URL: process.env.POPPAY_API_BASE_URL ?? "",
        POPPAY_URL: process.env.POPPAY_URL ?? "",
        POPPAY_PORT: process.env.POPPAY_PORT ?? "",
        POPPAY_VERSION: process.env.POPPAY_VERSION ?? "",
        POPPAY_INTEGRATOR_TOKEN: process.env.POPPAY_INTEGRATOR_TOKEN ?? "",
        POPPAY_AGGREGATOR_CODE: process.env.POPPAY_AGGREGATOR_CODE ?? "",
        POPPAY_MERCHANT_ACCOUNT_NUMBER: process.env.POPPAY_MERCHANT_ACCOUNT_NUMBER ?? "",
        POPPAY_SECRET_KEY: process.env.POPPAY_SECRET_KEY ?? "",
        POPPAY_EMAIL: process.env.POPPAY_EMAIL ?? "",
        POPPAY_PASSWORD: process.env.POPPAY_PASSWORD ?? "",
        PAYMENT_GATEWAY_QRIS_FEE_TYPE: process.env.PAYMENT_GATEWAY_QRIS_FEE_TYPE ?? "FIXED",
        PAYMENT_GATEWAY_QRIS_FEE_VALUE: process.env.PAYMENT_GATEWAY_QRIS_FEE_VALUE ?? "0",
        MERCHANT_PLATFORM_FEE_TYPE: process.env.MERCHANT_PLATFORM_FEE_TYPE ?? "FIXED",
        MERCHANT_PLATFORM_FEE_VALUE: process.env.MERCHANT_PLATFORM_FEE_VALUE ?? "0",
        DIGIFLAZZ_USERNAME: process.env.DIGIFLAZZ_USERNAME ?? "",
        DIGIFLAZZ_API_KEY: process.env.DIGIFLAZZ_API_KEY ?? "",
        DIGIFLAZZ_BASE_URL: process.env.DIGIFLAZZ_BASE_URL ?? "https://api.digiflazz.com/v1",
        VIP_API_ID: process.env.VIP_API_ID ?? "",
        VIP_API_KEY: process.env.VIP_API_KEY ?? "",
        VIP_SIGN: process.env.VIP_SIGN ?? "",
        VIP_BASE_URL: process.env.VIP_BASE_URL ?? "https://vip-reseller.co.id/api",
      },
    },
  });
}

const PatchSchema = z.object({
  key: z.string().min(1),
  value: z.string(),  // allow empty — empty value will delete the key (revert to .env default)
});

export async function PATCH(request: Request) {
  const deny = await requireAdmin();
  if (deny) return deny;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation error", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  if (parsed.data.key === "HEADER_COLOR" && parsed.data.value !== "") {
    const normalized = normalizeHexColor(parsed.data.value, "");
    if (!normalized) {
      return NextResponse.json(
        { success: false, error: "HEADER_COLOR must use #RRGGBB format" },
        { status: 422 }
      );
    }
    parsed.data.value = normalized;
  }

  // If value is empty, delete the key so it falls back to .env default
  if (parsed.data.value === "") {
    await deleteSiteConfig(parsed.data.key);
  } else {
    await setSiteConfig(parsed.data.key, parsed.data.value);
  }

  // Also sync ProviderFactory globalThis so it takes effect immediately
  await initProviderModesFromDB();

  const modes = await getAllProviderModes();
  return NextResponse.json({ success: true, data: { key: parsed.data.key, value: parsed.data.value, modes } });
}

export async function DELETE(request: Request) {
  const deny = await requireAdmin();
  if (deny) return deny;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ success: false, error: "key is required" }, { status: 400 });
  }

  await deleteSiteConfig(key);
  invalidateSiteConfigCache();
  await initProviderModesFromDB();

  const modes = await getAllProviderModes();
  return NextResponse.json({ success: true, data: { key, modes } });
}
