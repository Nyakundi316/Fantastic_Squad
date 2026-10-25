import { NextResponse } from "next/server";
import { CATALOG_PAGE_SIZE, listCatalog, parseCatalogQuery } from "@/server/catalog";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const filters = parseCatalogQuery((key) => req.nextUrl.searchParams.get(key));
  const result = await listCatalog(filters);
  return NextResponse.json({
    products: result.products.map((p) => ({ ...p, priceNote: "Product price only. Shipping is billed separately after measurement." })),
    page: result.page,
    pageSize: CATALOG_PAGE_SIZE,
    total: result.total,
    categories: result.categories,
    emptyReason: result.reason,
  });
});
