import { NextResponse } from "next/server";
import { getProductDetail } from "@/server/catalog";
import { HttpError, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ params: { id: string } }>(async (_req, { params }) => {
  const detail = /^[0-9a-f-]{36}$/i.test(params.id) ? await getProductDetail(params.id) : null;
  if (!detail) throw new HttpError(404, "product_not_found", "Product not found.");
  const { product, images, openBatches } = detail;

  return NextResponse.json({
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    images,
    variants: product.variants.map((v) => ({ id: v.id, label: v.label, sku: v.sku, price: v.buyingPrice.toFixed(2) })),
    priceNote: "Product price only. Shipping is billed separately after measurement.",
    shipping: (["sea", "air"] as const).map((method) => {
      const batch = openBatches[method];
      return {
        method,
        available: Boolean(batch),
        batch: batch ? { id: batch.id, name: batch.name, cutoffAt: batch.cutoffAt.toISOString(), memberCount: batch.memberCount } : null,
      };
    }),
  });
});
