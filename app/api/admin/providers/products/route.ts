import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/src/infra/db/prisma";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/providers/products
 * Get products from DATABASE only (no external API calls)
 */
async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const allProducts = await prisma.product.findMany({
      orderBy: [
        { provider: "asc" },
        { isActive: "desc" },
        { category: "asc" },
        { sellingPrice: "asc" },
      ],
    });

    // Group by provider
    const productsData: Record<string, any[]> = {};
    
    allProducts.forEach((product) => {
      if (!productsData[product.provider]) {
        productsData[product.provider] = [];
      }
      
      productsData[product.provider].push({
        code: product.providerCode,
        name: product.name,
        category: product.category,
        brand: product.brand,
        type: product.type,
        providerPrice: Number(product.providerPrice),
        margin: Number(product.margin),
        sellingPrice: Number(product.sellingPrice),
        stock: product.stock,
        isActive: product.isActive,
        description: product.description,
      });
    });

    return NextResponse.json({
      success: true,
      data: productsData,
      summary: {
        totalProviders: Object.keys(productsData).length,
        totalProducts: allProducts.length,
      },
    });
  } catch (error) {
    log.error({ err: error }, "failed to get products from database");
    
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get provider products",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/providers/products", GET_handler);
