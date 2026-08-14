/**
 * POST /api/admin/transactions/reconcile-all
 *
 * Bulk reconcile all stale PROCESSING_PROVIDER / PAID orders.
 * Admin only.
 */

import { NextResponse } from "next/server";
import { ReconcileOrderService } from "@/src/core/services/provider/reconcile-order.service";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { getSession } from "@/lib/session";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

const reconcileService = new ReconcileOrderService(
  new OrderRepository(),
);

async function POST_handler() {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || session.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const result = await reconcileService.reconcileStaleOrders();

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    log.error({ err }, "request failed");
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withRequestLog("/api/admin/transactions/reconcile-all", POST_handler);
