import { NextResponse } from "next/server";
import { prisma } from "@/src/infra/db/prisma";
import { requireAdmin } from "@/lib/admin-guard";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.admin");

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/products
 * Get all products with full details
 */
async function GET_handler() {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const products = await prisma.product.findMany({
      orderBy: [
        { isActive: "desc" },
        { category: "asc" },
        { sellingPrice: "asc" },
      ],
    });

    // Convert Decimal to number
    const productsData = products.map((product) => ({
      id: product.id,
      provider: product.provider,
      providerCode: product.providerCode,
      name: product.name,
      category: product.category,
      brand: product.brand,
      type: product.type,
      providerPrice: Number(product.providerPrice),
      margin: Number(product.margin),
      sellingPrice: Number(product.sellingPrice),
      stock: product.stock,
      description: product.description,
      isActive: product.isActive,
      lastSyncAt: product.lastSyncAt.toISOString(),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: productsData,
      meta: {
        total: productsData.length,
        active: productsData.filter((p) => p.isActive).length,
        inactive: productsData.filter((p) => !p.isActive).length,
      },
    });
  } catch (error) {
    log.error({ err: error }, "failed to get products");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch products",
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/products
 * Update product (margin, isActive)
 */
async function PUT_handler(request: Request) {
  try {
    const deny = await requireAdmin();
    if (deny) return deny;

    const body = await request.json();
    const { id, margin, isActive } = body;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Product ID is required",
        },
        { status: 400 }
      );
    }

    // Get current product to calculate new selling price
    const currentProduct = await prisma.product.findUnique({
      where: { id },
    });

    if (!currentProduct) {
      return NextResponse.json(
        {
          success: false,
          error: "Product not found",
        },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: any = {};

    if (margin !== undefined) {
      updateData.margin = margin;
      updateData.sellingPrice = Number(currentProduct.providerPrice) + margin;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // Update product
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    // Convert Decimal to number
    const productData = {
      id: updatedProduct.id,
      provider: updatedProduct.provider,
      providerCode: updatedProduct.providerCode,
      name: updatedProduct.name,
      category: updatedProduct.category,
      brand: updatedProduct.brand,
      type: updatedProduct.type,
      providerPrice: Number(updatedProduct.providerPrice),
      margin: Number(updatedProduct.margin),
      sellingPrice: Number(updatedProduct.sellingPrice),
      stock: updatedProduct.stock,
      description: updatedProduct.description,
      isActive: updatedProduct.isActive,
      lastSyncAt: updatedProduct.lastSyncAt.toISOString(),
      createdAt: updatedProduct.createdAt.toISOString(),
      updatedAt: updatedProduct.updatedAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: productData,
      message: "Product updated successfully",
    });
  } catch (error) {
    log.error({ err: error }, "failed to update product");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update product",
      },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog("/api/admin/products", GET_handler);
export const PUT = withRequestLog("/api/admin/products", PUT_handler);
