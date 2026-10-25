import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ORDER_FILTERS, isOrderFilterKey, shippingStatusLine, type OrderFilterKey } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { requireViewer } from "@/server/auth/viewer";
import { sortedImages } from "@/server/catalog";
import { listOrdersForUser } from "@/server/orders/queries";

export const metadata: Metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: { filter?: string } }) {
  const viewer = await requireViewer("/orders");
  const filter: OrderFilterKey = isOrderFilterKey(searchParams.filter) ? searchParams.filter : "all";
  const orders = await listOrdersForUser(viewer.id, ORDER_FILTERS[filter].statuses);

  return (
    <div className="container max-w-4xl pb-16 pt-6 sm:pt-10">
      <h1 className="text-2xl font-semibold sm:text-3xl">My orders</h1>

      <nav aria-label="Filter orders" className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {(Object.keys(ORDER_FILTERS) as OrderFilterKey[]).map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/orders" : `/orders?filter=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm",
              filter === key ? "bg-foreground text-surface" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {ORDER_FILTERS[key].label}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <div className="mt-10">
          <p className="font-medium">{filter === "all" ? "You have no orders yet." : "No orders in this view."}</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link href={filter === "all" ? "/#catalog" : "/orders"}>{filter === "all" ? "Browse preorders" : "Show all orders"}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {orders.map((order) => {
            const first = order.items[0];
            const productInvoice = order.invoices.find((i) => i.kind === "product");
            const shippingInvoice = order.invoices.find((i) => i.kind === "shipping");
            const productUnpaid = productInvoice?.status === "issued" && order.status !== "cancelled";
            const shippingDue = order.status === "invoiced" && shippingInvoice?.status === "issued";
            const extraItems = order._count.items - 1;

            return (
              <li key={order.id} className="rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5">
                <div className="grid grid-cols-[56px_1fr] gap-x-4 gap-y-3 sm:grid-cols-[72px_1fr_auto] sm:items-center">
                  <div className="relative size-14 overflow-hidden rounded-lg border border-border sm:size-[72px]">
                    <ProductImage image={first ? sortedImages(first.product.images)[0] ?? null : null} sizes="72px" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${order.id}`} className="tabular font-semibold hover:text-primary hover:underline">
                        {order.orderNumber}
                      </Link>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {first?.product.title}
                      {extraItems > 0 && ` and ${extraItems} more`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Placed {formatDate(order.createdAt)} · {shippingStatusLine(order.status, shippingInvoice ? formatMoney(shippingInvoice.amount) : null)}
                    </p>
                  </div>

                  <div className="col-span-2 flex items-center justify-between gap-4 border-t border-border pt-3 sm:col-span-1 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                    <div className="sm:text-right">
                      <p className="text-xs text-muted-foreground">Product total</p>
                      <p className="tabular font-semibold">{formatMoney(order.productTotal)}</p>
                    </div>
                    <Button asChild size="sm" variant={shippingDue || productUnpaid ? "primary" : "secondary"}>
                      <Link href={shippingDue && shippingInvoice ? `/invoices/${shippingInvoice.id}` : `/orders/${order.id}`}>
                        {shippingDue ? "Pay shipping" : productUnpaid ? "Pay product price" : "View order"}
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
