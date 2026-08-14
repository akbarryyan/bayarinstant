/**
 * GET /api/promos
 * Public endpoint — returns active promos, sorted by sortOrder then createdAt.
 * Filters out promos whose endDate has passed.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { getSiteConfig } from "@/lib/site-config";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.misc");

export const dynamic = "force-dynamic";

const DEFAULT_HERO_IMAGE =
  "https://www.vcgamers.com/_next/static/media/image-percent.4146a3ec.png";

async function GET_handler() {
  try {
    const now = new Date();
    const [promos, heroImageUrl] = await Promise.all([
      prisma.promo.findMany({
      where: {
        isActive: true,
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
      },
      orderBy: [
        { sortOrder: "asc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        linkUrl: true,
        startDate: true,
        endDate: true,
      },
    }),
      getSiteConfig("promo_hero_image_url"),
    ]);

    return NextResponse.json({
      success: true,
      data: promos,
      heroImageUrl: heroImageUrl ?? DEFAULT_HERO_IMAGE,
    });
  } catch (err) {
    log.error({ err }, "request failed");
    return NextResponse.json({ success: false, error: "Gagal memuat promo." }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/promos", GET_handler);
