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

/**
 * Server-side: apakah register wajib verifikasi OTP via email.
 * Priority: DB (site_config) → env → default true.
 */
export async function isRegisterOtpRequired(): Promise<boolean> {
  try {
    const { getSiteConfigValue } = await import("@/lib/site-config");
    const envDefault = process.env.REGISTER_OTP_REQUIRED !== "false" ? "true" : "false";
    const val = await getSiteConfigValue("REGISTER_OTP_REQUIRED", envDefault);
    return val !== "false";
  } catch {
    return process.env.REGISTER_OTP_REQUIRED !== "false";
  }
}
