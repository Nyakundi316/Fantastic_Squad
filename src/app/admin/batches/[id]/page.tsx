import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BatchStatusBadge, BatchStepper } from "@/components/batches/batch-status";
import { OrderStatusBadge, ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Card } from "@/components/ui/card";
import { ALLOCATION_METHOD_LABELS } from "@/lib/allocation-methods";
import { can } from "@/lib/auth/roles";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatWeight } from "@/lib/weight";
import { requireStaffViewer } from "@/server/auth/viewer";
import { closePreview, getBatchWithOrders } from "@/server/batches/detail";
import { BatchActions } from "./batch-actions";
import { QuoteForm } from "./quote-form";

export const metadata = { title: "Batch" };

export default async function BatchPage({ params }: { params: { id: string } }) {
  const staff = await requireStaffViewer(`/admin/batches/${params.id}`);
  const data = await getBatchWithOrders(params.id);
  if (!data) notFound();
  const { batch, orders, totals } = data;
  const unmeasured = totals.itemCount - totals.measuredItems;
  const canManage = can(staff.role, "batches.manage");
  const quoteEditable = canManage && (batch.status === "ordered" || batch.status === "measured");

  return (
    <div className="max-w-7xl">
      <Link href="/admin/batches" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Batches
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{batch.name}</h1>
        <ShipMethodBadge method={batch.defaultShipMethod} />
        <BatchStatusBadge status={batch.status} unallocated={batch.status === "measured" && batch._count.allocations === 0} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Cutoff {formatDateTime(batch.cutoffAt)}
        {batch.createdBy?.name && ` · opened by ${batch.createdBy.name} on ${formatDate(batch.createdAt)}`}
      </p>

      <div className="mt-5">
        <BatchStepper status={batch.status} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {[
          ["Orders", `${totals.orderCount}`, `${totals.units} units`],
          ["Total weight", totals.measuredWeightG ? formatWeight(totals.measuredWeightG) : "Not measured", `${totals.measuredItems} of ${totals.itemCount} items measured`],
          ["Product total", formatMoney(totals.productTotal), "Live orders only"],
          ["Shipping quote", batch.shippingQuote ? formatMoney(batch.shippingQuote) : "Not entered", batch.allocationMethod ? ALLOCATION_METHOD_LABELS[batch.allocationMethod] : "Split method not set"],
        ].map(([label, value, hint]) => (
          <div key={label} className="bg-surface p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="tabular mt-1 break-words text-xl font-semibold">{value}</dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <BatchActions
          batchId={batch.id}
          status={batch.status}
          canManage={canManage}
          canMeasure={can(staff.role, "measurements.write")}
          allMeasured={totals.itemCount > 0 && unmeasured === 0}
          unmeasured={unmeasured}
          closePreview={closePreview(orders)}
        />
      </div>

      {quoteEditable && (
        <Card className="mt-6 p-5">
          <h2 className="mb-4 text-sm font-semibold">Shipping quote</h2>
          <QuoteForm batchId={batch.id} quote={batch.shippingQuote?.toFixed(2) ?? null} method={batch.allocationMethod} />
        </Card>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold">Orders</h2>
        <div className="mt-3 overflow-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Units</th>
                <th className="px-4 py-3 text-right font-medium">Measured</th>
                <th className="px-4 py-3 text-right font-medium">Weight</th>
                <th className="px-4 py-3 text-right font-medium">Product total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => {
                const measured = order.items.filter((i) => i.measurement);
                const weight = measured.reduce((g, i) => g + i.measurement!.weightG * i.quantity, 0);
                return (
                  <tr key={order.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${order.id}`} className="tabular font-medium text-primary hover:underline">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{order.user.name ?? order.user.phone}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">{order.items.reduce((n, i) => n + i.quantity, 0)}</td>
                    <td className="tabular px-4 py-3 text-right">
                      <span className={measured.length < order.items.length ? "text-warning" : ""}>
                        {measured.length}/{order.items.length}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3 text-right">{weight ? formatWeight(weight) : "–"}</td>
                    <td className="tabular px-4 py-3 text-right">{formatMoney(order.productTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No orders in this batch yet.</p>}
        </div>
      </section>
    </div>
  );
}
