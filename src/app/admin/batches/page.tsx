import Link from "next/link";
import { BatchStatusBadge } from "@/components/batches/batch-status";
import { ShipMethodBadge } from "@/components/orders/order-status-badge";
import { can } from "@/lib/auth/roles";
import { BATCH_STATUS } from "@/lib/batch-status";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { formatWeight } from "@/lib/weight";
import { requireStaffViewer } from "@/server/auth/viewer";
import { listBatchSummaries, type BatchSummary } from "@/server/batches/list";
import { NewBatchForm } from "./new-batch-form";

export const metadata = { title: "Batches" };

const KANBAN_COLUMNS = ["collecting", "ordered", "measured", "invoiced", "shipped"] as const;

const isUnallocated = (b: BatchSummary) => b.status === "measured" && !b.approved;

function MeasuredBar({ batch }: { batch: BatchSummary }) {
  if (batch.itemCount === 0) return null;
  const percent = Math.round((batch.measuredItems / batch.itemCount) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full", percent === 100 ? "bg-success" : "bg-primary")} style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular text-xs text-muted-foreground">
        {batch.measuredItems}/{batch.itemCount}
      </span>
    </div>
  );
}

export default async function BatchesPage({ searchParams }: { searchParams: { view?: string } }) {
  const staff = await requireStaffViewer("/admin/batches");
  const batches = await listBatchSummaries();
  const view = searchParams.view === "list" ? "list" : "board";
  const offBoard = batches.filter((b) => b.status === "delivered" || b.status === "cancelled").length;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Batches</h1>
          <div className="mt-3 inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="View">
            {(["board", "list"] as const).map((v) => (
              <Link
                key={v}
                role="tab"
                aria-selected={view === v}
                href={v === "board" ? "/admin/batches" : "/admin/batches?view=list"}
                className={cn("rounded-md px-3 py-1", view === v ? "bg-surface font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "board" ? "Board" : "List"}
              </Link>
            ))}
          </div>
        </div>
        {can(staff.role, "batches.manage") && <NewBatchForm />}
      </div>

      {view === "board" ? (
        <>
          <div className="mt-6 grid gap-4 overflow-x-auto pb-2 md:grid-cols-5">
            {KANBAN_COLUMNS.map((column) => {
              const cards = batches.filter((b) => b.status === column);
              return (
                <section key={column} className="min-w-[220px] rounded-xl bg-muted/60 p-2" aria-label={BATCH_STATUS[column].label}>
                  <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-medium">
                    {BATCH_STATUS[column].label}
                    <span className="tabular text-xs text-muted-foreground">{cards.length}</span>
                  </h2>
                  <ul className="space-y-2">
                    {cards.map((batch) => (
                      <li key={batch.id}>
                        <Link
                          href={`/admin/batches/${batch.id}`}
                          className="block rounded-lg border border-border bg-surface p-3 shadow-xs transition-colors hover:border-foreground/25"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">{batch.name}</p>
                            <ShipMethodBadge method={batch.defaultShipMethod} />
                          </div>
                          <p className="tabular mt-1 text-xs text-muted-foreground">
                            {batch.orderCount} orders · cutoff {formatDate(batch.cutoffAt, { day: "numeric", month: "short" })}
                          </p>
                          {column !== "collecting" && <div className="mt-2.5"><MeasuredBar batch={batch} /></div>}
                          {isUnallocated(batch) && <p className="mt-2 text-xs font-medium text-danger">Needs allocation</p>}
                        </Link>
                      </li>
                    ))}
                    {cards.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">None</li>}
                  </ul>
                </section>
              );
            })}
          </div>
          {offBoard > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {offBoard} delivered or cancelled {offBoard === 1 ? "batch is" : "batches are"} in the{" "}
              <Link href="/admin/batches?view=list" className="text-primary hover:underline">
                list view
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <div className="mt-6 overflow-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
              <tr>
                <th className="px-4 py-3 font-medium">Batch</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Cutoff</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="w-40 px-4 py-3 font-medium">Measured</th>
                <th className="px-4 py-3 text-right font-medium">Weight</th>
                <th className="px-4 py-3 text-right font-medium">Product total</th>
                <th className="px-4 py-3 text-right font-medium">Quote</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/batches/${batch.id}`} className="font-medium text-primary hover:underline">
                      {batch.name}
                    </Link>
                    <span className="ml-2 align-middle">
                      <ShipMethodBadge method={batch.defaultShipMethod} />
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <BatchStatusBadge status={batch.status} unallocated={isUnallocated(batch)} />
                  </td>
                  <td className="tabular px-4 py-3 text-muted-foreground">{formatDate(batch.cutoffAt)}</td>
                  <td className="tabular px-4 py-3 text-right">{batch.orderCount}</td>
                  <td className="px-4 py-3">
                    <MeasuredBar batch={batch} />
                  </td>
                  <td className="tabular px-4 py-3 text-right">{batch.measuredWeightG ? formatWeight(batch.measuredWeightG) : "–"}</td>
                  <td className="tabular px-4 py-3 text-right">{formatMoney(batch.productTotal)}</td>
                  <td className="tabular px-4 py-3 text-right">{batch.shippingQuote ? formatMoney(batch.shippingQuote) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {batches.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No batches yet.</p>}
        </div>
      )}
    </div>
  );
}
