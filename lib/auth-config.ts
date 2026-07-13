export function isOtpAuthEnabled() {
  return process.env.AUTH_OTP_ENABLED !== "false";
}

export const isOtpAuthEnabledClient =
  process.env.NEXT_PUBLIC_AUTH_OTP_ENABLED !== "false";

/**
 * Server-side: apakah user harus login sebelum bisa beli.
 * Priority: DB (site_config) → env → default true.
 */
export async function isLoginRequiredForPurchase(): Promise<boolean> {
  try {
    const { getSiteConfigValue } = await import("@/lib/site-config");
    const envDefault = process.env.REQUIRE_LOGIN_TO_PURCHASE !== "false" ? "true" : "false";
    const val = await getSiteConfigValue("REQUIRE_LOGIN_TO_PURCHASE", envDefault);
    return val !== "false";
  } catch {
    return process.env.REQUIRE_LOGIN_TO_PURCHASE !== "false";
  }
}
