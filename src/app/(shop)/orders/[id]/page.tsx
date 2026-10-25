import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, FileText } from "lucide-react";
import { ProductImage } from "@/components/catalog/product-image";
import { OrderStatusBadge, ShipMethodBadge } from "@/components/orders/order-status-badge";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/order-status";
import { requireViewer } from "@/server/auth/viewer";
import { sortedImages } from "@/server/catalog";
import { currentInvoice, getOrderForViewer } from "@/server/orders/queries";
import { CancelOrderButton } from "./cancel-order-button";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params, searchParams }: { params: { id: string }; searchParams: { placed?: string } }) {
  const viewer = await requireViewer(`/orders/${params.id}`);
  const order = await getOrderForViewer(params.id, viewer);
  if (!order) notFound();

  const productInvoice = currentInvoice(order, "product");
  const shippingInvoice = currentInvoice(order, "shipping");
  const productPaid = productInvoice?.status === "paid";
  const bank = env();
  const showShippingCard = shippingInvoice?.status === "issued" && order.status === "invoiced";
  const canCancel = order.status === "preorder_placed" && productInvoice?.status !== "paid" && order.userId === viewer.id;
  const shipment = order.batch?.shipments[0] ?? null;
  const held = order.status === "invoiced" && (order.batch?.status === "shipped" || order.batch?.status === "delivered");

  return (
    <div className="container max-w-5xl pb-16 pt-6">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        My orders
      </Link>

      {searchParams.placed && order.status === "preorder_placed" && (
        <div role="status" className="mt-4 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm">
          <span className="font-medium">Preorder placed.</span>{" "}
          {productPaid ? "Your product payment is confirmed." : "Pay the product price below to keep your place in the batch."}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="tabular text-2xl font-semibold sm:text-3xl">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <ShipMethodBadge method={order.shipMethod} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Placed {formatDateTime(order.createdAt)}
        {order.batch && ` · ${order.batch.name}, cutoff ${formatDate(order.batch.cutoffAt)}`}
      </p>

      <Card className="mt-6 p-4 sm:p-6">
        <OrderTimeline status={order.status} />
        {shipment && (order.status === "shipped" || order.status === "delivered" || held) && (
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
            {shipment.carrier ?? "Carrier"} · tracking {shipment.trackingNumber ?? "to follow"}
            {shipment.departedAt && ` · left China ${formatDate(shipment.departedAt)}`}
            {shipment.estimatedDays && order.status === "shipped" && ` · about ${shipment.estimatedDays} days in transit`}
          </p>
        )}
      </Card>

      {held && (
        <p role="status" className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          Your items travelled with the batch and are being held at our destination warehouse. They are released for delivery as soon as
          the shipping invoice is paid.
        </p>
      )}

      {showShippingCard && shippingInvoice && (
        <section className="mt-6 rounded-xl border-2 border-primary/30 bg-surface p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <p className="text-sm font-medium text-primary">Shipping invoice ready</p>
            <p className="tabular mt-1 text-2xl font-semibold">{formatMoney(shippingInvoice.amount, shippingInvoice.currency)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your share of the batch shipping quote{shippingInvoice.dueAt && `, due ${formatDate(shippingInvoice.dueAt)}`}.
            </p>
          </div>
          <Button asChild size="md" className="mt-4 w-full sm:mt-0 sm:w-auto">
            <Link href={`/invoices/${shippingInvoice.id}`}>See breakdown and pay</Link>
          </Button>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <h2 className="border-b border-border px-5 py-4 text-base font-semibold">Items</h2>
          <ul className="divide-y divide-border">
            {order.items.map((item) => (
              <li key={item.id} className="grid grid-cols-[48px_1fr_auto] items-center gap-4 px-5 py-3">
                <div className="relative size-12 overflow-hidden rounded-lg border border-border">
                  <ProductImage image={sortedImages(item.product.images)[0] ?? null} sizes="48px" />
                </div>
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{item.product.title}</p>
                  <p className="tabular text-muted-foreground">
                    {item.variant.label} · {item.quantity} × {formatMoney(item.unitPrice)}
                  </p>
                </div>
                <p className="tabular text-sm font-medium">{formatMoney(item.lineTotal)}</p>
              </li>
            ))}
          </ul>
          <dl className="space-y-2 border-t border-border px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Product total</dt>
              <dd className="tabular">{formatMoney(order.productTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="tabular">
                {shippingInvoice ? formatMoney(order.shippingTotal) : <span className="text-muted-foreground">Billed after measurement</span>}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <dt>{shippingInvoice ? "Total" : "Total so far"}</dt>
              <dd className="tabular">{formatMoney(order.grandTotal)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Product payment</h2>
              {productInvoice && <Badge tone={INVOICE_STATUS[productInvoice.status].tone}>{INVOICE_STATUS[productInvoice.status].label}</Badge>}
            </div>
            {productInvoice?.status === "paid" && (
              <p className="mt-2 text-sm text-muted-foreground">
                {formatMoney(productInvoice.amount)} received {productInvoice.paidAt && formatDate(productInvoice.paidAt)}.
              </p>
            )}
            {productInvoice?.status === "issued" && order.status !== "cancelled" && (
              <div className="mt-3 text-sm">
                <p>
                  Transfer <span className="tabular font-semibold">{formatMoney(productInvoice.amount)}</span>
                  {productInvoice.dueAt && <> by {formatDate(productInvoice.dueAt, { weekday: "short", day: "numeric", month: "short" })}</>}.
                </p>
                {bank.BANK_ACCOUNT_NUMBER ? (
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted p-3">
                    <dt className="text-muted-foreground">Bank</dt>
                    <dd>{bank.BANK_NAME}</dd>
                    <dt className="text-muted-foreground">Account</dt>
                    <dd className="tabular font-medium">{bank.BANK_ACCOUNT_NUMBER}</dd>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd>{bank.BANK_ACCOUNT_NAME}</dd>
                    <dt className="text-muted-foreground">Reference</dt>
                    <dd className="tabular font-medium">{order.orderNumber}</dd>
                  </dl>
                ) : (
                  <p className="mt-2 text-muted-foreground">We will send payment details on WhatsApp.</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">We confirm transfers within one working day.</p>
              </div>
            )}
            {productInvoice?.status === "voided" && <p className="mt-2 text-sm text-muted-foreground">Voided when the order was cancelled.</p>}
            {productInvoice && productInvoice.status !== "voided" && (
              <div className="mt-3 flex gap-4 text-sm">
                {productInvoice.status === "issued" && (
                  <Link href={`/invoices/${productInvoice.id}`} className="text-primary hover:underline">
                    Pay online
                  </Link>
                )}
                <a href={`/api/invoices/${productInvoice.id}/pdf`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Download className="size-4" aria-hidden />
                  PDF
                </a>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Shipping payment</h2>
              {shippingInvoice ? (
                <Badge tone={INVOICE_STATUS[shippingInvoice.status].tone}>{INVOICE_STATUS[shippingInvoice.status].label}</Badge>
              ) : (
                <Badge>Not billed yet</Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {shippingInvoice
                ? `Your share of the ${order.shipMethod} freight for ${order.batch?.name ?? "this batch"}.`
                : "Billed separately once your items are measured in China. There is no shipping figure yet."}
            </p>
            {shippingInvoice && (
              <div className="mt-3 flex gap-4 text-sm">
                <Link href={`/invoices/${shippingInvoice.id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <FileText className="size-4" aria-hidden />
                  View shipping invoice
                </Link>
                <a href={`/api/invoices/${shippingInvoice.id}/pdf`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Download className="size-4" aria-hidden />
                  PDF
                </a>
              </div>
            )}
          </Card>

          {order.shipAddress && (
            <Card className="p-5 text-sm">
              <h2 className="text-base font-semibold">Delivery</h2>
              <p className="mt-2 font-medium">{order.shipAddress.fullName}</p>
              <p className="text-muted-foreground">
                {[order.shipAddress.line1, order.shipAddress.line2, order.shipAddress.city, order.shipAddress.state].filter(Boolean).join(", ")}
              </p>
              <p className="tabular text-muted-foreground">{order.shipAddress.phone}</p>
            </Card>
          )}

          {canCancel && <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />}
        </div>
      </div>
    </div>
  );
}
