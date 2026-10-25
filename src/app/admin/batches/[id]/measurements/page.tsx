import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BatchStatusBadge } from "@/components/batches/batch-status";
import { can } from "@/lib/auth/roles";
import { MEASURABLE_STATUSES } from "@/lib/batch-status";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/dates";
import { requireStaffViewer } from "@/server/auth/viewer";
import { getBatchWithOrders } from "@/server/batches/detail";
import { MeasurementSheet, type SheetRow } from "./measurement-sheet";

export const metadata = { title: "Measurements" };

type Snapshot = { orderNumber?: string; weightG?: number; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null };

function describe(s: Snapshot | null) {
  if (!s) return "";
  const dims = s.lengthMm ? ` · ${s.lengthMm}×${s.widthMm}×${s.heightMm} mm` : "";
  return `${s.weightG} g${dims}`;
}

export default async function MeasurementsPage({ params }: { params: { id: string } }) {
  const staff = await requireStaffViewer(`/admin/batches/${params.id}/measurements`);
  const data = await getBatchWithOrders(params.id);
  if (!data) notFound();
  const { batch, orders } = data;

  const editable = can(staff.role, "measurements.write") && MEASURABLE_STATUSES.includes(batch.status) && batch._count.allocations === 0;

  const rows: SheetRow[] = orders.flatMap((order) =>
    order.items.map((item) => ({
      orderItemId: item.id,
      orderNumber: order.orderNumber,
      customer: order.user.name ?? order.user.phone ?? "",
      product: item.product.title,
      variant: item.variant.label,
      quantity: item.quantity,
      weightG: item.measurement?.weightG ?? null,
      lengthMm: item.measurement?.lengthMm ?? null,
      widthMm: item.measurement?.widthMm ?? null,
      heightMm: item.measurement?.heightMm ?? null,
    })),
  );

  const history = await db.auditLog.findMany({
    where: { entityType: "measurement", after: { path: ["batchId"], equals: batch.id } },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { actor: { select: { name: true } } },
  });

  return (
    <div className="max-w-7xl">
      <Link href={`/admin/batches/${batch.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        {batch.name}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Measurements</h1>
        <BatchStatusBadge status={batch.status} />
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Weight is per unit, in grams. Dimensions are per unit, in millimetres, and only matter for volumetric splits.
        {!editable && " This batch is read-only here."}
      </p>

      <div className="mt-6">
        <MeasurementSheet batchId={batch.id} batchName={batch.name} rows={rows} editable={editable} />
      </div>

      <section className="mt-10 max-w-3xl">
        <h2 className="text-base font-semibold">Change history</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No measurements recorded yet.</p>
        ) : (
          <ol className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {history.map((entry) => {
              const after = entry.after as Snapshot | null;
              const before = entry.before as Snapshot | null;
              return (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="tabular font-medium">{after?.orderNumber}</span>
                  <span className="text-muted-foreground">
                    {entry.action === "measurement.created" ? "measured" : "changed"} by {entry.actor?.name ?? "system"}
                  </span>
                  <span className="tabular">
                    {before && <span className="text-muted-foreground line-through">{describe(before)}</span>} {describe(after)}
                  </span>
                  <time className="ml-auto text-xs text-muted-foreground" dateTime={entry.createdAt.toISOString()}>
                    {relativeTime(entry.createdAt)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
