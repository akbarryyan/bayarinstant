/**
 * GET  /api/admin/home-content  — returns current game tags + FAQ
 * PUT  /api/admin/home-content  — replaces entire home content
 * DELETE /api/admin/home-content — resets to defaults
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getHomeContent, setHomeContent, deleteSiteConfig } from "@/lib/site-config";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

async function GET_handler() {
  const deny = await requireAdmin();
  if (deny) return deny;

  const data = await getHomeContent();
  return NextResponse.json({ success: true, data });
}

const GameTagSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

const FaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const PutSchema = z.object({
  gameTags: z.array(GameTagSchema),
  faqs: z.array(FaqSchema),
  aboutText: z.string().default(""),
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

  await setHomeContent(parsed.data);
  return NextResponse.json({ success: true, data: parsed.data });
}

async function DELETE_handler() {
  const deny = await requireAdmin();
  if (deny) return deny;

  await deleteSiteConfig("HOME_CONTENT");
  const data = await getHomeContent(); // returns defaults
  return NextResponse.json({ success: true, data });
}

export const GET = withRequestLog("/api/admin/home-content", GET_handler);
export const PUT = withRequestLog("/api/admin/home-content", PUT_handler);
export const DELETE = withRequestLog("/api/admin/home-content", DELETE_handler);
