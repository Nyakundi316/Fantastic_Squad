import Link from "next/link";
import { Anchor, Plane, Tag } from "lucide-react";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { ProductCard } from "@/components/catalog/product-card";
import { Button } from "@/components/ui/button";
import { daysUntil, formatDate } from "@/lib/dates";
import { CATALOG_PAGE_SIZE, listCatalog, parseCatalogQuery } from "@/server/catalog";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = Object.fromEntries(
    Object.entries(searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;
  const filters = parseCatalogQuery((key) => params[key]);
  const catalog = await listCatalog(filters);
  const nextBatch = catalog.batches[0];
  const cardBatch = catalog.batches.find((b) => !filters.shipMethod || b.shipMethod === filters.shipMethod);
  const pageCount = Math.ceil(catalog.total / CATALOG_PAGE_SIZE);
  const activeParams = {
    category: filters.category,
    shipMethod: filters.shipMethod,
    batchClosing: filters.closingWithinDays?.toString(),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
  };
  const pageHref = (page: number) => {
    const query = new URLSearchParams(Object.entries(activeParams).filter((e): e is [string, string] => Boolean(e[1])));
    query.set("page", String(page));
    return `/?${query}#catalog`;
  };

  return (
    <>
      <section className="container grid gap-10 pb-10 pt-10 sm:pt-16 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          <p className="text-sm font-medium text-primary">Group preorders from China</p>
          <h1 className="mt-3 max-w-[18ch] text-3xl font-bold sm:text-5xl">
            Pay the buying price. Split the shipping fairly.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Join a batch, we buy at source and measure every item in China. The batch shipping quote is then split
            across orders by weight, and you see every number before you pay it.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="md">
              <Link href="/#catalog">Browse preorders</Link>
            </Button>
            <Button asChild size="md" variant="secondary">
              <Link href="/how-shipping-works">How shipping works</Link>
            </Button>
          </div>
        </div>

        {nextBatch && (
          <aside className="self-end rounded-xl border border-border bg-surface p-5 shadow-xs lg:col-span-5 lg:mb-2 lg:ml-auto lg:w-full lg:max-w-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Now collecting</p>
            <p className="mt-1 text-lg font-semibold">{nextBatch.name}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Cutoff</dt>
              <dd className="text-right font-medium">{formatDate(nextBatch.cutoffAt)}</dd>
              <dt className="text-muted-foreground">Closes in</dt>
              <dd className="tabular text-right font-medium">
                {daysUntil(nextBatch.cutoffAt) === 0 ? "Today" : `${daysUntil(nextBatch.cutoffAt)} days`}
              </dd>
              <dt className="text-muted-foreground">Members</dt>
              <dd className="tabular text-right font-medium">{nextBatch.memberCount}</dd>
            </dl>
          </aside>
        )}
      </section>

      <section aria-label="How pricing works" className="border-y border-border bg-surface">
        <ul className="container grid divide-y divide-border text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <li className="flex items-center gap-3 py-4 sm:pr-6">
            <Tag className="size-4 text-primary" aria-hidden />
            <span>
              <span className="font-medium">Product price only</span>
              <span className="text-muted-foreground"> at checkout</span>
            </span>
          </li>
          <li className="flex items-center gap-3 py-4 sm:px-6">
            <Anchor className="size-4 text-info" aria-hidden />
            <span>
              <span className="font-medium">Sea</span>
              <span className="text-muted-foreground"> 30–45 days</span>
            </span>
          </li>
          <li className="flex items-center gap-3 py-4 sm:pl-6">
            <Plane className="size-4 text-info" aria-hidden />
            <span>
              <span className="font-medium">Air</span>
              <span className="text-muted-foreground"> faster, costlier</span>
            </span>
          </li>
        </ul>
      </section>

      <section id="catalog" className="container scroll-mt-28 py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl font-semibold">Open preorders</h2>
          {catalog.total > 0 && (
            <p className="tabular text-sm text-muted-foreground">
              {catalog.total} {catalog.total === 1 ? "product" : "products"}
            </p>
          )}
        </div>

        <div className="mt-5">
          <CatalogFilters params={activeParams} categories={catalog.categories} />
        </div>

        {catalog.products.length === 0 ? (
          <div className="mt-10 max-w-md">
            <p className="font-medium">
              {catalog.reason === "no_open_batch"
                ? filters.shipMethod === "air"
                  ? "No air batch is open right now."
                  : "No batch matches those filters right now."
                : "Nothing matches those filters."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {catalog.reason === "no_open_batch"
                ? "New batches open regularly. Sea shipping is usually available."
                : "Try another category or price range."}
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link href="/#catalog">Show all preorders</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {catalog.products.map((product, i) => (
              <ProductCard key={product.id} product={product} batch={cardBatch} priority={i < 2} />
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <nav aria-label="Pages" className="mt-10 flex items-center gap-3 text-sm">
            {catalog.page > 1 && (
              <Link
                className="text-primary hover:underline"
                href={pageHref(catalog.page - 1)}
              >
                Previous
              </Link>
            )}
            <span className="tabular text-muted-foreground">
              Page {catalog.page} of {pageCount}
            </span>
            {catalog.page < pageCount && (
              <Link
                className="text-primary hover:underline"
                href={pageHref(catalog.page + 1)}
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
