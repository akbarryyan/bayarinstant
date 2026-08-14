import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { getSession } from "@/lib/session";
import { withRequestLog } from "@/src/infra/logging/with-request-log";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || session.role !== "ADMIN") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * GET /api/admin/brand-reviews
 * List all reviews (approved + pending) with optional filters.
 * Query: status=all|pending|approved, search, page
 */
async function GET_handler(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? "all";
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const PAGE_SIZE = 20;

  const where = {
    ...(status === "pending" ? { isApproved: false } : status === "approved" ? { isApproved: true } : {}),
    ...(search
      ? {
          OR: [
            { brandSlug: { contains: search } },
            { userName: { contains: search } },
            { comment: { contains: search } },
          ],
        }
      : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.brandReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        brandSlug: true,
        userId: true,
        userName: true,
        rating: true,
        comment: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.brandReview.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: reviews,
    meta: { total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) },
  });
}

/**
 * PATCH /api/admin/brand-reviews
 * Approve or reject (delete) a review.
 * Body: { id, action: "approve" | "reject" }
 */
async function PATCH_handler(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;

  const body = await req.json();
  const { id, action } = body;

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ success: false, error: "Parameter tidak valid." }, { status: 400 });
  }

  if (action === "approve") {
    await prisma.brandReview.update({ where: { id }, data: { isApproved: true } });
    return NextResponse.json({ success: true, message: "Ulasan disetujui." });
  } else {
    await prisma.brandReview.delete({ where: { id } });
    return NextResponse.json({ success: true, message: "Ulasan dihapus." });
  }
}

/**
 * DELETE /api/admin/brand-reviews?id=xxx
 * Hard delete a review.
 */
async function DELETE_handler(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "ID diperlukan." }, { status: 400 });

  await prisma.brandReview.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

export const GET = withRequestLog("/api/admin/brand-reviews", GET_handler);
export const PATCH = withRequestLog("/api/admin/brand-reviews", PATCH_handler);
export const DELETE = withRequestLog("/api/admin/brand-reviews", DELETE_handler);
