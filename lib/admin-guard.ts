import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

/**
 * Server-side guard for admin API routes.
 * Returns a 401 NextResponse if the caller is not a logged-in ADMIN, otherwise null.
 * Usage: const deny = await requireAdmin(); if (deny) return deny;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId || session.role !== "ADMIN") {
    // Penolakan di admin API adalah sinyal keamanan; sebelumnya hilang total.
    log.warn(
      { isLoggedIn: Boolean(session.isLoggedIn), role: session.role ?? null },
      "admin guard denied"
    );
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
