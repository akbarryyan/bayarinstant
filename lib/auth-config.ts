export function isOtpAuthEnabled() {
  return process.env.AUTH_OTP_ENABLED !== "false";
}

export const isOtpAuthEnabledClient =
  process.env.NEXT_PUBLIC_AUTH_OTP_ENABLED !== "false";

/** Server-side: apakah user harus login sebelum bisa beli. Default true jika env tidak di-set. */
export function isLoginRequiredForPurchase() {
  return process.env.REQUIRE_LOGIN_TO_PURCHASE !== "false";
}

/** Client-side: apakah user harus login sebelum bisa beli. */
export const isLoginRequiredForPurchaseClient =
  process.env.NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE !== "false";
