import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listActiveBatches, openBatchByMethod, type ActiveBatchSummary } from "@/server/batches/active";

export type ProductImage = { url: string; alt: string; order: number };

export function sortedImages(images: Prisma.JsonValue): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return (images as ProductImage[]).filter((i) => i && typeof i.url === "string").sort((a, b) => a.order - b.order);
}

export type CatalogFilters = {
  category?: string;
  shipMethod?: "sea" | "air";
  /** Only show products while a matching batch closes within this many days. */
  closingWithinDays?: number;
  minPrice?: string;
  maxPrice?: string;
  page?: number;
};

export type CatalogCard = {
  id: string;
  title: string;
  category: string | null;
  image: ProductImage | null;
  fromPrice: string;
  variantCount: number;
};

export const CATALOG_PAGE_SIZE = 12;

const MONEY_PARAM = /^\d{1,10}(\.\d{1,2})?$/;

/** Shared by the home page (searchParams) and GET /api/products. Bad values are ignored, not errors. */
export function parseCatalogQuery(get: (key: string) => string | null | undefined): CatalogFilters {
  const category = get("category")?.trim() || undefined;
  const ship = get("shipMethod");
  const closing = Number(get("batchClosing"));
  const minPrice = get("minPrice");
  const maxPrice = get("maxPrice");
  const page = Number(get("page"));
  return {
    category: category && category.length <= 80 ? category : undefined,
    shipMethod: ship === "sea" || ship === "air" ? ship : undefined,
    closingWithinDays: Number.isInteger(closing) && closing > 0 && closing <= 90 ? closing : undefined,
    minPrice: minPrice && MONEY_PARAM.test(minPrice) ? minPrice : undefined,
    maxPrice: maxPrice && MONEY_PARAM.test(maxPrice) ? maxPrice : undefined,
    page: Number.isInteger(page) && page > 0 ? page : undefined,
  };
}

/**
 * Batches are store-wide (one per ship method), so the batch filters gate the
 * whole catalogue: filtering by air shows nothing while no air batch is open.
 */
export async function listCatalog(filters: CatalogFilters, now = new Date()) {
  const batches = await listActiveBatches(now);
  const page = Math.max(1, filters.page ?? 1);

  const eligibleBatches = batches.filter((b) => {
    if (filters.shipMethod && b.shipMethod !== filters.shipMethod) return false;
    if (filters.closingWithinDays !== undefined) {
      return b.cutoffAt.getTime() - now.getTime() <= filters.closingWithinDays * 86_400_000;
    }
    return true;
  });

  const categories = (
    await db.product.findMany({
      where: { isActive: true, category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    })
  ).map((c) => c.category!);

  const empty = { products: [] as CatalogCard[], total: 0, page, categories, batches };
  if (eligibleBatches.length === 0) return { ...empty, reason: "no_open_batch" as const };

  const where = Prisma.sql`p.is_active AND v.is_active ${filters.category ? Prisma.sql`AND p.category = ${filters.category}` : Prisma.empty}`;
  const having = Prisma.join(
    [
      Prisma.sql`TRUE`,
      ...(filters.minPrice ? [Prisma.sql`MIN(v.buying_price) >= ${new Prisma.Decimal(filters.minPrice)}`] : []),
      ...(filters.maxPrice ? [Prisma.sql`MIN(v.buying_price) <= ${new Prisma.Decimal(filters.maxPrice)}`] : []),
    ],
    " AND ",
  );

  const rows = await db.$queryRaw<Array<{ id: string; from_price: Prisma.Decimal; variant_count: bigint; total: bigint }>>`
    SELECT p.id, MIN(v.buying_price) AS from_price, COUNT(v.id) AS variant_count, COUNT(*) OVER () AS total
    FROM products p
    JOIN product_variants v ON v.product_id = p.id
    WHERE ${where}
    GROUP BY p.id
    HAVING ${having}
    ORDER BY p.created_at DESC, p.id
    LIMIT ${CATALOG_PAGE_SIZE} OFFSET ${(page - 1) * CATALOG_PAGE_SIZE}`;

  if (rows.length === 0) return { ...empty, reason: "no_match" as const };

  const details = await db.product.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, title: true, category: true, images: true },
  });
  const byId = new Map(details.map((d) => [d.id, d]));

  const products: CatalogCard[] = rows.map((row) => {
    const product = byId.get(row.id)!;
    return {
      id: product.id,
      title: product.title,
      category: product.category,
      image: sortedImages(product.images)[0] ?? null,
      fromPrice: new Prisma.Decimal(row.from_price).toFixed(2),
      variantCount: Number(row.variant_count),
    };
  });

  return { products, total: Number(rows[0]!.total), page, categories, batches, reason: null };
}

export async function getProductDetail(id: string) {
  const product = await db.product.findFirst({
    where: { id, isActive: true },
    include: { variants: { where: { isActive: true }, orderBy: { buyingPrice: "asc" } } },
  });
  if (!product || product.variants.length === 0) return null;
  const batches = await listActiveBatches();
  return { product, images: sortedImages(product.images), batches, openBatches: openBatchByMethod(batches) };
}

export type { ActiveBatchSummary };
