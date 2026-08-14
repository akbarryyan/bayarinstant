/**
 * GET /api/footer-config
 * Public endpoint — returns footer configuration with defaults fallback.
 */

import { NextResponse } from "next/server";
import { getAllSiteConfig, getSiteName } from "@/lib/site-config";
import { getFooterVisitorStats } from "@/lib/analytics";
import { DEFAULT_FOOTER_COLUMNS } from "@/lib/footer-columns";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.misc");

export const dynamic = "force-dynamic";

function buildFooterDefaults(siteName: string) {
  const year = new Date().getFullYear();

  return {
    site_name: siteName,
    footer_logo_url: "",
    footer_tagline: `Top Up Game Murah & PPOB Terpercaya? ${siteName} Aja!`,
    footer_payment_methods: JSON.stringify([
      { name: "GoPay", img: "" },
      { name: "DANA", img: "" },
      { name: "Shopee", img: "" },
      { name: "OVO", img: "" },
      { name: "QRIS", img: "" },
    ]),
    footer_company_name: siteName,
    footer_contact_phone: "",
    footer_contact_email: "",
    footer_info_links: JSON.stringify([
      { label: "Tentang Kami", type: "page", slug: "tentang-kami", href: "/info/tentang-kami" },
      { label: "Syarat dan Ketentuan", type: "page", slug: "syarat-dan-ketentuan", href: "/info/syarat-dan-ketentuan" },
      { label: "Kebijakan Privasi", type: "page", slug: "kebijakan-privasi", href: "/info/kebijakan-privasi" },
    ]),
    footer_other_links: JSON.stringify([
      { label: "Karir", type: "page", slug: "karir", href: "/info/karir" },
    ]),
    footer_columns: JSON.stringify(DEFAULT_FOOTER_COLUMNS),
    footer_social_links: JSON.stringify([
      { platform: "instagram", href: "#" },
      { platform: "facebook", href: "#" },
      { platform: "youtube", href: "#" },
      { platform: "discord", href: "#" },
      { platform: "tiktok", href: "#" },
    ]),
    footer_copyright: `Copyright ©2024 - ${year}\n${siteName}. All rights reserved.`,
  };
}

async function GET_handler() {
  try {
    const [raw, visitorStats, siteName] = await Promise.all([
      getAllSiteConfig(),
      getFooterVisitorStats(),
      getSiteName(),
    ]);
    const defaults = buildFooterDefaults(siteName);

    // Merge DB values over defaults
    const config: Record<string, string> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (raw[key] != null) config[key] = raw[key];
    }

    return NextResponse.json({
      success: true,
      data: {
        ...config,
        visitorStats,
      },
    });
  } catch (err) {
    log.error({ err }, "request failed");
    const defaults = buildFooterDefaults(await getSiteName().catch(() => "Website"));
    return NextResponse.json({
      success: true,
      data: {
        ...defaults,
        visitorStats: {
          visitorsToday: 0,
          totalVisits: 0,
          pagesToday: 0,
        },
      },
    });
  }
}

export const GET = withRequestLog("/api/footer-config", GET_handler);
