import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { OrderStatusBadge, ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/roles";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/order-status";
import { requireStaffViewer } from "@/server/auth/viewer";
import { getOrderForViewer } from "@/server/orders/queries";
import { AdjustInvoiceForm } from "./adjust-invoice-form";
import { MarkPaidForm } from "./mark-paid-form";
import { NotesForm } from "./notes-form";

export const metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: { params: { id: string } }) {
  const staff = await requireStaffViewer(`/admin/orders/${params.id}`);
  const order = await getOrderForViewer(params.id, staff);
  if (!order) notFound();
  const canMarkPaid = can(staff.role, "payments.mark_paid");
  const canAdjust = can(staff.role, "invoices.adjust");

  return (
    <div className="max-w-6xl">
      <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="tabular text-2xl font-semibold">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <ShipMethodBadge method={order.shipMethod} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Placed {formatDateTime(order.createdAt)}
        {order.batch && (
          <>
            {" · "}
            <Link href={`/admin/batches/${order.batch.id}`} className="text-primary hover:underline">
              {order.batch.name}
            </Link>
          </>
        )}
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Items</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 font-medium">Product</th>
                    <th className="px-5 py-2 text-right font-medium">Qty</th>
                    <th className="px-5 py-2 text-right font-medium">Unit price</th>
                    <th className="px-5 py-2 text-right font-medium">Line total</th>
                    <th className="px-5 py-2 text-right font-medium">Weight / unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.items.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/50">
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{item.product.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.variant.label}
                          {item.variant.sku && ` · ${item.variant.sku}`}
                        </p>
                      </td>
                      <td className="tabular px-5 py-2.5 text-right">{item.quantity}</td>
                      <td className="tabular px-5 py-2.5 text-right">{formatMoney(item.unitPrice)}</td>
                      <td className="tabular px-5 py-2.5 text-right">{formatMoney(item.lineTotal)}</td>
                      <td className="tabular px-5 py-2.5 text-right text-muted-foreground">
                        {item.measurement ? `${item.measurement.weightG.toLocaleString("en-NG")} g` : "Not measured"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border">
                  <tr>
                    <td colSpan={3} className="px-5 py-2.5 text-right text-muted-foreground">
                      Product total
                    </td>
                    <td className="tabular px-5 py-2.5 text-right font-semibold">{formatMoney(order.productTotal)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-5 pb-3 text-right text-muted-foreground">
                      Shipping
                    </td>
                    <td className="tabular px-5 pb-3 text-right">{formatMoney(order.shippingTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Invoices</h2>
            {order.invoices.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No invoices.</p>
            ) : (
              <ul className="divide-y divide-border">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {invoice.kind} invoice <span className="font-normal text-muted-foreground">v{invoice.version}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Issued {formatDate(invoice.issuedAt)}
                          {invoice.dueAt && ` · due ${formatDate(invoice.dueAt)}`}
                          {invoice.paidAt && ` · paid ${formatDateTime(invoice.paidAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tabular font-semibold">{formatMoney(invoice.amount, invoice.currency)}</span>
                        <Badge tone={INVOICE_STATUS[invoice.status].tone}>{INVOICE_STATUS[invoice.status].label}</Badge>
                      </div>
                    </div>
                    {invoice.status === "issued" && order.status !== "cancelled" && (canMarkPaid || canAdjust) && (
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {canMarkPaid && <MarkPaidForm invoiceId={invoice.id} amountLabel={formatMoney(invoice.amount, invoice.currency)} />}
                        {canAdjust && <AdjustInvoiceForm invoiceId={invoice.id} currentAmount={invoice.amount.toFixed(2)} />}
                      </div>
                    )}
                    <a href={`/api/invoices/${invoice.id}/pdf`} className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground">
                      Download PDF
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {order.payments.length > 0 && (
            <Card>
              <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Payments</h2>
              <ul className="divide-y divide-border text-sm">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span>
                      <span className="capitalize">{p.kind}</span>
                      <span className="text-muted-foreground"> · {p.method.replace("_", " ")}</span>
                      {p.paidAt && <span className="text-muted-foreground"> · {formatDateTime(p.paidAt)}</span>}
                    </span>
                    <span className="tabular font-medium">{formatMoney(p.amount, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <p className="mt-2 font-medium">{order.user.name ?? "No name"}</p>
            <p className="tabular text-muted-foreground">{order.user.phone}</p>
            <p className="text-muted-foreground">{order.user.email}</p>
            {order.user.role === "dropshipper" && <Badge tone="accent" className="mt-2">Dropshipper</Badge>}
            {order.shipAddress && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deliver to</p>
                <p className="mt-1">{order.shipAddress.fullName}</p>
                <p className="text-muted-foreground">
                  {[order.shipAddress.line1, order.shipAddress.line2, order.shipAddress.city, order.shipAddress.state].filter(Boolean).join(", ")}
                </p>
                <p className="tabular text-muted-foreground">{order.shipAddress.phone}</p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold">Internal notes</h2>
            <div className="mt-3">
              {can(staff.role, "notes.write") ? (
                <NotesForm orderId={order.id} notes={order.notes ?? ""} />
              ) : (
                <p className="text-sm text-muted-foreground">{order.notes ?? "None"}</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
