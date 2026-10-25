import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ALLOCATION_METHOD_LABELS } from "@/lib/allocation-methods";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatExactShare, formatMoney } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/order-status";
import { formatWeight } from "@/lib/weight";
import { requireViewer } from "@/server/auth/viewer";
import { getInvoiceForViewer, invoiceView } from "@/server/invoices";
import { paystackConfigured } from "@/server/payments/paystack";
import { PayButton } from "./pay-button";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function InvoicePage({ params, searchParams }: { params: { id: string }; searchParams: { reference?: string } }) {
  const viewer = await requireViewer(`/invoices/${params.id}`);
  const record = await getInvoiceForViewer(params.id, viewer);
  if (!record) notFound();
  const invoice = invoiceView(record);
  const money = (v: string) => formatMoney(v, invoice.currency);
  const payable = invoice.status === "issued" && invoice.order.status !== "cancelled" && invoice.order.userId === viewer.id;
  const confirming = payable && Boolean(searchParams.reference);
  const bank = env();
  const status = INVOICE_STATUS[invoice.status];

  return (
    <div className="container max-w-4xl pb-16 pt-6">
      <Link href={`/orders/${invoice.order.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Order {invoice.order.orderNumber}
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold sm:text-3xl">{invoice.kind === "shipping" ? "Shipping invoice" : "Product invoice"}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        {invoice.version > 1 && <Badge>Version {invoice.version}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {invoice.order.orderNumber} · issued {formatDate(invoice.issuedAt)}
        {invoice.dueAt && invoice.status === "issued" && ` · due ${formatDate(invoice.dueAt)}`}
        {invoice.paidAt && ` · paid ${formatDate(invoice.paidAt)}`}
      </p>

      {invoice.status === "adjusted" && (
        <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm">This invoice was replaced by a newer version. See the order for the current invoice.</p>
      )}
      {invoice.adjustment && (
        <p className="mt-4 rounded-lg bg-info-soft px-4 py-3 text-sm">
          Replaces version {invoice.adjustment.previousVersion} ({money(invoice.adjustment.previousAmount)}): {invoice.adjustment.reason}
        </p>
      )}

      {invoice.kind === "shipping" ? (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Batch quote</dt>
              <dd className="tabular font-medium">{money(invoice.shipping.batchQuote)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Method</dt>
              <dd className="font-medium capitalize">{invoice.shipping.shipMethod} freight</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Batch weight</dt>
              <dd className="tabular font-medium">{formatWeight(invoice.shipping.totalBatchWeightG)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Your weight</dt>
              <dd className="tabular font-medium">{formatWeight(invoice.shipping.order.chargeableWeightG)}</dd>
            </div>
          </dl>

          <Card className="mt-6 overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_64px_140px_120px] gap-4 border-b border-border px-4 py-3 text-xs text-muted-foreground sm:grid">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Weight share</span>
              <span className="text-right">Your cost</span>
            </div>
            <ul className="divide-y divide-border text-sm">
              {invoice.items.map((item, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_64px_140px_120px] sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {item.variant}
                      <span className="sm:hidden">
                        {" "}
                        · qty {item.quantity} · {formatWeight(item.lineChargeableG)} ({item.weightSharePercent}%)
                      </span>
                    </p>
                  </div>
                  <span className="tabular hidden text-right sm:block">{item.quantity}</span>
                  <span className="tabular hidden text-right sm:block">
                    {formatWeight(item.lineChargeableG)}
                    <span className="block text-xs text-muted-foreground">{item.weightSharePercent}% of your order</span>
                  </span>
                  <span className="tabular text-right">{money(item.cost)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-4 bg-primary/[0.04] px-4 py-4">
              <span className="font-medium">Shipping total</span>
              <span className="tabular text-2xl font-semibold">{money(invoice.amount)}</span>
            </div>
          </Card>

          <details className="group mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
              How was this calculated? <span className="text-muted-foreground group-open:hidden">Show</span>
            </summary>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <p>
                {invoice.shipping.batch.name} was quoted <span className="tabular text-foreground">{money(invoice.shipping.batchQuote)}</span> to ship{" "}
                <span className="tabular text-foreground">{formatWeight(invoice.shipping.totalBatchWeightG)}</span> of goods for{" "}
                {invoice.shipping.orderCount} orders by {invoice.shipping.shipMethod}. The quote is split {ALLOCATION_METHOD_LABELS[invoice.shipping.method].toLowerCase()}.
              </p>
              {invoice.shipping.volumetricDivisor && (
                <p>
                  Each item is charged at the greater of its actual weight and its volumetric weight: length × width × height in mm ÷{" "}
                  {invoice.shipping.volumetricDivisor}, rounded up to the gram.
                </p>
              )}
              <p className="tabular rounded-lg bg-muted px-3 py-2 text-foreground">
                {invoice.shipping.formula} = {formatExactShare(invoice.shipping.exactShare)}
              </p>
              <p>
                Rounded to 2 decimal places that is <span className="tabular text-foreground">{money(invoice.shipping.amount)}</span>.
                {invoice.shipping.residualApplied &&
                  ` It includes a ${invoice.shipping.residualApplied} rounding adjustment so the batch shares add up to the quote exactly.`}
              </p>
            </div>
          </details>
        </>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <ul className="divide-y divide-border text-sm">
            {invoice.product.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <span>
                  <span className="font-medium">{l.title}</span>
                  <span className="tabular block text-muted-foreground">
                    {l.variant} · {l.quantity} × {money(l.unitPrice)}
                  </span>
                </span>
                <span className="tabular">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-4 bg-primary/[0.04] px-4 py-4">
            <span className="font-medium">Product total</span>
            <span className="tabular text-2xl font-semibold">{money(invoice.amount)}</span>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Product price only. Shipping is separate and billed later, once your items are measured in China.
          </p>
        </Card>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        {payable ? (
          <section aria-label="Pay this invoice" className="space-y-4">
            {confirming ? (
              <p role="status" className="rounded-lg bg-info-soft px-4 py-3 text-sm">
                We are confirming your payment with Paystack. This page shows Paid once it is confirmed, usually within a minute.
              </p>
            ) : (
              paystackConfigured() && <PayButton invoiceId={invoice.id} label={`Pay ${money(invoice.amount)} by card or transfer`} />
            )}
            {bank.BANK_ACCOUNT_NUMBER && (
              <div className="text-sm">
                <p className="text-muted-foreground">{paystackConfigured() ? "Or pay by direct bank transfer:" : "Pay by bank transfer:"}</p>
                <p className="tabular mt-1">
                  {bank.BANK_NAME} · {bank.BANK_ACCOUNT_NUMBER} · {bank.BANK_ACCOUNT_NAME} · reference <span className="font-medium">{invoice.order.orderNumber}</span>
                </p>
              </div>
            )}
          </section>
        ) : (
          <div />
        )}
        <a
          href={`/api/invoices/${invoice.id}/pdf`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </a>
      </div>
    </div>
  );
}
