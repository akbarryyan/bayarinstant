import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Server-side guard for admin API routes.
 * Returns a 401 NextResponse if the caller is not a logged-in ADMIN, otherwise null.
 * Usage: const deny = await requireAdmin(); if (deny) return deny;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId || session.role !== "ADMIN") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
