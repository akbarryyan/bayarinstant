import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { UPLOAD_FOLDERS } from "@/lib/upload";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Fallback for user-uploaded files under public/uploads/**.
 *
 * next start snapshots public/ file listings at boot, so a file written by
 * saveUploadedImage() after boot 404s via Next's normal static serving until
 * the process restarts. This route reads the file from disk fresh on every
 * request, so it never goes stale — Next only reaches this handler when its
 * own static lookup misses.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;

  const [folder, ...rest] = segments;
  if (!UPLOAD_FOLDERS.includes(folder as (typeof UPLOAD_FOLDERS)[number]) || rest.length === 0) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const filename = rest.join("/");
  if (filename.includes("..")) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "public", "uploads", folder, filename);
  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  if (!filePath.startsWith(uploadsRoot + path.sep) || !existsSync(filePath)) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const buffer = await readFile(filePath);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
