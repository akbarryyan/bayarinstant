/**
 * GET  /api/admin/flash-sale  — returns current flash sale config
 * PUT  /api/admin/flash-sale  — replaces entire flash sale config
 * DELETE /api/admin/flash-sale — resets to default (inactive, empty)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getFlashSaleConfig,
  setFlashSaleConfig,
  type FlashSaleConfig,
} from "@/lib/site-config";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

async function GET_handler() {
  const deny = await requireAdmin();
  if (deny) return deny;

  const config = await getFlashSaleConfig();
  return NextResponse.json({ success: true, data: config });
}

const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().default(""),
  brandImage: z.string().default(""),
  badge: z.string().default(""),
  discount: z.string().default(""),
  originalPrice: z.string().default(""),
  price: z.string(),
});

const PutSchema = z.object({
  isActive: z.boolean(),
  endTime: z.string().datetime({ message: "endTime harus format ISO datetime" }),
  products: z.array(ProductSchema),
});

async function PUT_handler(request: Request) {
  const deny = await requireAdmin();
  if (deny) return deny;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation error", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  await setFlashSaleConfig(parsed.data as FlashSaleConfig);
  return NextResponse.json({ success: true, data: parsed.data });
}

async function DELETE_handler() {
  const deny = await requireAdmin();
  if (deny) return deny;

  const defaultCfg: FlashSaleConfig = {
    isActive: false,
    endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    products: [],
  };
  await setFlashSaleConfig(defaultCfg);
  return NextResponse.json({ success: true, data: defaultCfg });
}

export const GET = withRequestLog("/api/admin/flash-sale", GET_handler);
export const PUT = withRequestLog("/api/admin/flash-sale", PUT_handler);
export const DELETE = withRequestLog("/api/admin/flash-sale", DELETE_handler);
