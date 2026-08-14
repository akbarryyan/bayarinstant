/**
 * POST /api/upload
 * Generic authenticated image upload endpoint — saves files to disk under
 * public/uploads/<folder>/ and returns the resulting local path.
 * Body: multipart/form-data with `file` and `folder` fields.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { saveUploadedImage, UploadError, UPLOAD_FOLDERS, type UploadFolder } from "@/lib/upload";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.misc");

export const dynamic = "force-dynamic";

const ADMIN_ONLY_FOLDERS = new Set<UploadFolder>(["promos", "brands", "banners", "payment-methods", "site", "footer"]);

async function POST_handler(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const folder = formData.get("folder");

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "File gambar wajib diunggah." }, { status: 400 });
  }
  if (typeof folder !== "string" || !UPLOAD_FOLDERS.includes(folder as UploadFolder)) {
    return NextResponse.json({ success: false, error: "Folder tujuan tidak valid." }, { status: 400 });
  }

  const targetFolder = folder as UploadFolder;
  if (ADMIN_ONLY_FOLDERS.has(targetFolder) && session.role !== "ADMIN") {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = await saveUploadedImage(file, targetFolder);
    return NextResponse.json({ success: true, data: { url } });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    log.error({ err: error }, "request failed");
    return NextResponse.json({ success: false, error: "Gagal mengunggah gambar." }, { status: 500 });
  }
}

export const POST = withRequestLog("/api/upload", POST_handler);
