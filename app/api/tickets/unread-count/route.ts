import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

/**
 * GET /api/tickets/unread-count — returns unread ticket count for badge
 */
async function GET_handler() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return NextResponse.json({ count: 0 });
  }

  const tickets = await prisma.ticket.findMany({
    where: { userId: session.userId, status: { not: "CLOSED" } },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const count = tickets.filter(
    (t) => t.messages[0]?.senderRole === "ADMIN"
  ).length;

  return NextResponse.json({ count });
}

export const GET = withRequestLog("/api/tickets/unread-count", GET_handler);
