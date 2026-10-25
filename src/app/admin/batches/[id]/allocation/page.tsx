import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft, Info } from "lucide-react";
import { Prisma } from "@prisma/client";
import { BatchStatusBadge } from "@/components/batches/batch-status";
import { ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ALLOCATION_METHOD_LABELS } from "@/lib/allocation-methods";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatWeight } from "@/lib/weight";
import { previewAllocation, type PreviewRow } from "@/server/allocation/batch-allocation";
import { requireStaffViewer } from "@/server/auth/viewer";
import { HttpError } from "@/server/http";
import { QuoteForm } from "../quote-form";
import { ApproveButton } from "./approve-button";

export const metadata = { title: "Shipping allocation" };

function AllocationTable({ rows, quote, allocated }: { rows: PreviewRow[]; quote: string; allocated: string }) {
  return (
    <div className="overflow-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
          <tr>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 text-right font-medium">Items</th>
            <th className="px-4 py-3 text-right font-medium">Weight</th>
            <th className="px-4 py-3 text-right font-medium">Product total</th>
            <th className="px-4 py-3 text-right font-medium">Shipping share</th>
            <th className="px-4 py-3 text-right font-medium">Grand total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.orderId} className="hover:bg-muted/60">
              <td className="px-4 py-3">
                <p className="font-medium">{row.customer}</p>
                <p className="tabular text-xs text-muted-foreground">{row.orderNumber}</p>
              </td>
              <td className="tabular px-4 py-3 text-right">{row.units}</td>
              <td className="tabular px-4 py-3 text-right">{formatWeight(row.chargeableWeightG)}</td>
              <td className="tabular px-4 py-3 text-right">{formatMoney(row.productTotal)}</td>
              <td className="tabular px-4 py-3 text-right font-semibold">
                {formatMoney(row.shippingShare)}
                {row.residualApplied && (
                  <span className="block text-[11px] font-normal text-muted-foreground" title="Rounding residual so the split sums to the quote exactly">
                    incl. {row.residualApplied} rounding
                  </span>
                )}
              </td>
              <td className="tabular px-4 py-3 text-right">{formatMoney(row.grandTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border">
          <tr>
            <td colSpan={4} className="px-4 py-3 text-right font-medium">
              Allocated
            </td>
            <td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(allocated)}</td>
            <td className="px-4 py-3 text-right text-xs">
              {allocated === quote ? (
                <span className="text-success">Matches the quote exactly</span>
              ) : (
                <span className="text-danger">Quote is {formatMoney(quote)}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function AllocationPage({ params }: { params: { id: string } }) {
  const staff = await requireStaffViewer(`/admin/batches/${params.id}/allocation`);
  let preview;
  try {
    preview = await previewAllocation(params.id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
  const { batch } = preview;

  const approvedRows = preview.approved
    ? await db.shippingAllocation.findMany({
        where: { batchId: batch.id },
        include: { order: { include: { user: { select: { name: true, phone: true } }, items: { select: { quantity: true } } } }, approvedBy: { select: { name: true } } },
        orderBy: { order: { orderNumber: "asc" } },
      })
    : [];

  return (
    <div className="max-w-6xl">
      <Link href={`/admin/batches/${batch.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        {batch.name}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Shipping allocation</h1>
        <ShipMethodBadge method={batch.defaultShipMethod} />
        <BatchStatusBadge status={batch.status} unallocated={batch.status === "measured" && !preview.approved} />
      </div>

      {preview.approved ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Approved by {approvedRows[0]?.approvedBy?.name ?? "staff"} on {approvedRows[0]?.approvedAt && formatDateTime(approvedRows[0].approvedAt)}.{" "}
            {approvedRows.length} shipping invoices were sent. These figures are final.
          </p>
          <div className="mt-6">
            <AllocationTable
              quote={approvedRows[0]?.shippingQuote.toFixed(2) ?? "0.00"}
              allocated={approvedRows.reduce((sum, r) => sum.add(r.allocatedAmount), new Prisma.Decimal(0)).toFixed(2)}
              rows={approvedRows.map((r) => ({
                orderId: r.orderId,
                orderNumber: r.order.orderNumber,
                customer: r.order.user.name ?? r.order.user.phone ?? "Customer",
                units: r.order.items.reduce((n, i) => n + i.quantity, 0),
                chargeableWeightG: r.orderWeightG,
                productTotal: r.order.productTotal.toFixed(2),
                shippingShare: r.allocatedAmount.toFixed(2),
                grandTotal: r.order.productTotal.add(r.allocatedAmount).toFixed(2),
                residualApplied: null,
              }))}
            />
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p>
              <span className="font-medium">No invoice will be sent until you approve.</span> This preview is recalculated every time the page loads and is
              not saved.
            </p>
          </div>

          {can(staff.role, "batches.manage") && (batch.status === "measured" || batch.status === "ordered") && (
            <Card className="mt-6 p-5">
              <QuoteForm batchId={batch.id} quote={batch.shippingQuote?.toFixed(2) ?? null} method={batch.allocationMethod} />
            </Card>
          )}

          {preview.error ? (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-medium">Can&rsquo;t split the quote yet</p>
                <p className="mt-0.5">{preview.error.message}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Quote</span> <span className="tabular font-semibold">{formatMoney(preview.result.quote)}</span>
                  <span className="text-muted-foreground"> · {ALLOCATION_METHOD_LABELS[preview.result.method]}</span>
                  {preview.result.volumetricDivisor && <span className="text-muted-foreground"> · divisor {preview.result.volumetricDivisor}</span>}
                </p>
                <p className="tabular text-muted-foreground">
                  {preview.result.orderCount} orders · {formatWeight(preview.result.totalChargeableWeightG)} chargeable
                </p>
              </div>
              <div className="mt-3">
                <AllocationTable rows={preview.rows} quote={preview.result.quote} allocated={preview.allocatedTotal} />
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-start gap-3">
            {can(staff.role, "measurements.write") && (
              <Button asChild variant="secondary" size="md">
                <Link href={`/admin/batches/${batch.id}/measurements`}>Edit measurements</Link>
              </Button>
            )}
            {can(staff.role, "allocation.approve") && preview.fingerprint && batch.status === "measured" && (
              <ApproveButton
                batchId={batch.id}
                fingerprint={preview.fingerprint}
                orderCount={preview.rows.length}
                totalLabel={formatMoney(preview.allocatedTotal)}
              />
            )}
          </div>
          {batch.status === "ordered" && !preview.error && (
            <p className="mt-3 text-sm text-muted-foreground">Mark the batch as measured to approve this split.</p>
          )}
        </>
      )}
    </div>
  );
}
