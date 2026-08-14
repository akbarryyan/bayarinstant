import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

/**
 * GET /api/notifications — returns notifications for current user
 * Includes user-specific + broadcast (userId = null) notifications.
 * Query params: ?limit=20&unreadOnly=false
 */
async function GET_handler(req: NextRequest) {
  const session = await getSession();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  // Build OR conditions: broadcast + user-specific (if logged in)
  const orConditions: Array<Record<string, unknown>> = [
    { userId: null }, // broadcast
  ];
  if (session.isLoggedIn && session.userId) {
    orConditions.push({ userId: session.userId });
  }

  const notifications = await prisma.notification.findMany({
    where: { OR: orConditions },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Unread count
  const unreadCount = await prisma.notification.count({
    where: {
      OR: orConditions,
      isRead: false,
    },
  });

  return NextResponse.json({
    success: true,
    data: notifications,
    unreadCount,
  });
}

export const GET = withRequestLog("/api/notifications", GET_handler);
