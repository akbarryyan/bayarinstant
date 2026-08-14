import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-guard";
import { getSiteConfig, setSiteConfig } from "@/lib/site-config";
import { cookies } from "next/headers";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

const KEY = "MAINTENANCE_MODE";

async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const val = await getSiteConfig(KEY);
    return NextResponse.json({ success: true, enabled: val === "1" });
  } catch (err) {
    log.error({ err }, "request failed");
    return NextResponse.json({ success: false, enabled: false }, { status: 500 });
  }
}

async function PATCH_handler() {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || session.role !== "ADMIN") {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const current = await getSiteConfig(KEY);
    const next = current === "1" ? "0" : "1";
    await setSiteConfig(KEY, next);

    // Set or clear the _maint cookie so middleware can read it cheaply
    const cookieStore = await cookies();
    if (next === "1") {
      cookieStore.set("_maint", "1", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    } else {
      cookieStore.set("_maint", "", {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 0,
      });
    }

    return NextResponse.json({ success: true, enabled: next === "1" });
  } catch (err) {
    log.error({ err }, "request failed");
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export const GET = withRequestLog("/api/admin/maintenance", GET_handler);
export const PATCH = withRequestLog("/api/admin/maintenance", PATCH_handler);
