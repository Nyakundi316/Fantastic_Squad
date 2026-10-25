import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ActiveBatchSummary, CatalogCard } from "@/server/catalog";
import { BatchProgress } from "./batch-progress";
import { ProductImage } from "./product-image";

export function ProductCard({ product, batch, priority }: { product: CatalogCard; batch?: ActiveBatchSummary; priority?: boolean }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex flex-col rounded-xl focus-visible:ring-offset-4"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface">
        <ProductImage
          image={product.image}
          priority={priority}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>

      <div className="mt-3 flex-1">
        {product.category && <p className="text-xs text-muted-foreground">{product.category}</p>}
        <h3 className="mt-0.5 line-clamp-2 text-sm font-medium group-hover:text-primary">{product.title}</h3>
        <p className="tabular mt-1.5 text-base font-semibold">
          {product.variantCount > 1 && <span className="text-xs font-normal text-muted-foreground">From </span>}
          {formatMoney(product.fromPrice)}
        </p>
        <p className="text-xs text-muted-foreground">Product price only. Shipping billed later.</p>
      </div>

      {batch && <BatchProgress batch={batch} className="mt-3" />}
    </Link>
  );
}
