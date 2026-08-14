import { NextResponse } from "next/server";
import { getHeaderColor, getSiteConfig, getSiteConfigValue, getSiteName } from "@/lib/site-config";
import { isRegisterOtpRequired } from "@/lib/auth-config";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

/**
 * GET /api/site-branding — public endpoint returning site identity (logo, name, etc.)
 */
async function GET_handler() {
  const [siteName, siteLogo, headerColor, requireLoginRaw, registerOtpRequired] = await Promise.all([
    getSiteName(),
    getSiteConfig("site_logo"),
    getHeaderColor(),
    getSiteConfigValue("REQUIRE_LOGIN_TO_PURCHASE", process.env.REQUIRE_LOGIN_TO_PURCHASE !== "false" ? "true" : "false"),
    isRegisterOtpRequired(),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      site_name: siteName,
      site_logo: siteLogo || "",
      header_color: headerColor,
      require_login_to_purchase: requireLoginRaw !== "false",
      register_otp_required: registerOtpRequired,
    },
  });
}

export const GET = withRequestLog("/api/site-branding", GET_handler);
