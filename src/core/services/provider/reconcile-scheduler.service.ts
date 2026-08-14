import { OrderStatus } from "@/src/core/domain/enums/order.enum";
import { OrderRepository } from "@/src/infra/db/repositories/order.repository";
import { ReconcileOrderService } from "./reconcile-order.service";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("order.reconcile");

const g = globalThis as unknown as {
  _orderReconcileTimers?: Map<string, ReturnType<typeof setTimeout>>;
};

if (!g._orderReconcileTimers) {
  g._orderReconcileTimers = new Map();
}

function clearScheduled(orderId: string) {
  const timer = g._orderReconcileTimers?.get(orderId);
  if (timer) {
    clearTimeout(timer);
    g._orderReconcileTimers?.delete(orderId);
  }
}

export function scheduleOrderReconcile(
  orderId: string,
  opts?: { delayMs?: number; maxAttempts?: number; attempt?: number }
) {
  const delayMs = opts?.delayMs ?? 45_000;
  const maxAttempts = opts?.maxAttempts ?? 4;
  const attempt = opts?.attempt ?? 1;

  if (attempt > maxAttempts) return;
  if (g._orderReconcileTimers?.has(orderId)) return;

  const timer = setTimeout(async () => {
    g._orderReconcileTimers?.delete(orderId);

    try {
      const orderRepo = new OrderRepository();
      const reconcileService = new ReconcileOrderService(orderRepo);
      const result = await reconcileService.reconcile(orderId);

      if (result.status === "pending" || result.status === "re-executed") {
        scheduleOrderReconcile(orderId, {
          delayMs: delayMs * 2,
          maxAttempts,
          attempt: attempt + 1,
        });
      }
    } catch (error) {
      log.error({ err: error, orderId }, "scheduled reconcile failed");
      scheduleOrderReconcile(orderId, {
        delayMs: delayMs * 2,
        maxAttempts,
        attempt: attempt + 1,
      });
    }
  }, delayMs);

  g._orderReconcileTimers?.set(orderId, timer);
}

export async function autoReconcileOrderNow(orderId: string) {
  clearScheduled(orderId);

  const orderRepo = new OrderRepository();
  const order = await orderRepo.findById(orderId);
  if (!order) return null;

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PROCESSING_PROVIDER) {
    return order;
  }

  const reconcileService = new ReconcileOrderService(orderRepo);
  try {
    const result = await reconcileService.reconcile(orderId);
    if (result.status === "pending" || result.status === "re-executed") {
      scheduleOrderReconcile(orderId);
    }
  } catch (error) {
    log.error({ err: error, orderId }, "auto reconcile failed");
    scheduleOrderReconcile(orderId);
  }

  return orderRepo.findById(orderId);
}
