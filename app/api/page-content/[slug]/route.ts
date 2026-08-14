/**
 * GET /api/page-content/[slug]
 * Public endpoint — returns rich-text HTML content for a given page slug.
 */

import { NextResponse } from "next/server";
import { getAllSiteConfig, getSiteConfig } from "@/lib/site-config";
import { FooterLinkItem, findFooterPageBySlug, normalizeFooterLinks } from "@/lib/footer-links";
import { DEFAULT_FOOTER_COLUMNS, FooterColumnItem, collectFooterColumnPageLinks, normalizeFooterColumns } from "@/lib/footer-columns";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.misc");

export const dynamic = "force-dynamic";

async function GET_handler(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const key = `page_content_${slug}`;

  try {
    const [content, rawConfig] = await Promise.all([
      getSiteConfig(key),
      getAllSiteConfig(),
    ]);
    const infoLinks = normalizeFooterLinks(JSON.parse(rawConfig.footer_info_links ?? "[]") as FooterLinkItem[], []);
    const otherLinks = normalizeFooterLinks(JSON.parse(rawConfig.footer_other_links ?? "[]") as FooterLinkItem[], []);
    const footerColumns = normalizeFooterColumns(
      JSON.parse(rawConfig.footer_columns ?? "[]") as FooterColumnItem[],
      [
        ...DEFAULT_FOOTER_COLUMNS,
        { title: "Informasi", links: infoLinks },
        { title: "Lainnya", links: otherLinks },
      ]
    );
    const pageMeta =
      collectFooterColumnPageLinks(footerColumns).find((item) => item.slug === slug) ??
      findFooterPageBySlug(slug, infoLinks, otherLinks);
    return NextResponse.json({
      success: true,
      data: { slug, title: pageMeta?.label ?? null, content: content ?? "" },
    });
  } catch (err) {
    log.error({ err, slug }, "request failed");
    return NextResponse.json({
      success: true,
      data: { slug, title: null, content: "" },
    });
  }
}

export const GET = withRequestLog("/api/page-content/[slug]", GET_handler);
