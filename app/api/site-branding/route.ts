import { NextResponse } from "next/server";
import { getHeaderColor, getSiteConfig, getSiteConfigValue, getSiteName } from "@/lib/site-config";

/**
 * GET /api/site-branding — public endpoint returning site identity (logo, name, etc.)
 */
export async function GET() {
  const [siteName, siteLogo, headerColor, requireLoginRaw] = await Promise.all([
    getSiteName(),
    getSiteConfig("site_logo"),
    getHeaderColor(),
    getSiteConfigValue("REQUIRE_LOGIN_TO_PURCHASE", process.env.REQUIRE_LOGIN_TO_PURCHASE !== "false" ? "true" : "false"),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      site_name: siteName,
      site_logo: siteLogo || "",
      header_color: headerColor,
      require_login_to_purchase: requireLoginRaw !== "false",
    },
  });
}
