import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BatchProgress } from "@/components/catalog/batch-progress";
import { AfterOrderSteps } from "@/components/orders/after-order-steps";
import { can } from "@/lib/auth/roles";
import { formatDate } from "@/lib/dates";
import { getViewer } from "@/server/auth/viewer";
import { getProductDetail } from "@/server/catalog";
import { BULK_LINE_LIMIT, CUSTOMER_LINE_LIMIT } from "@/server/orders/place-order";
import { Gallery } from "./gallery";
import { PurchasePanel } from "./purchase-panel";

export const dynamic = "force-dynamic";

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const detail = isUuid(params.id) ? await getProductDetail(params.id) : null;
  return { title: detail?.product.title ?? "Product" };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const detail = isUuid(params.id) ? await getProductDetail(params.id) : null;
  if (!detail) notFound();
  const { product, images, batches, openBatches } = detail;
  const viewer = await getViewer();
  const maxQuantity = viewer && can(viewer.role, "orders.bulk") ? BULK_LINE_LIMIT : CUSTOMER_LINE_LIMIT;

  return (
    <div className="container pb-16 pt-6">
      <Link href="/#catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        All preorders
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <Gallery images={images} title={product.title} />

        <div className="lg:sticky lg:top-28 lg:self-start">
          {product.category && <p className="text-sm text-muted-foreground">{product.category}</p>}
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{product.title}</h1>

          {batches[0] && <BatchProgress batch={batches[0]} showName className="mt-4 max-w-sm" />}

          <div className="mt-6">
            <PurchasePanel
              maxQuantity={maxQuantity}
              variants={product.variants.map((v) => ({ id: v.id, label: v.label, price: v.buyingPrice.toFixed(2) }))}
              methods={(["sea", "air"] as const).map((method) => ({
                method,
                batchName: openBatches[method]?.name ?? null,
                closes: openBatches[method] ? formatDate(openBatches[method]!.cutoffAt, { day: "numeric", month: "short" }) : null,
              }))}
            />
          </div>
        </div>
      </div>

      {product.description && (
        <section className="mt-14 max-w-2xl">
          <h2 className="text-xl font-semibold">About this product</h2>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{product.description}</p>
        </section>
      )}

      <div className="mt-14 border-t border-border pt-12">
        <AfterOrderSteps />
      </div>
    </div>
  );
}
