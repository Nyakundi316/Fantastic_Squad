import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { daysUntil, formatDate, relativeTime, startOfLagosDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listActiveBatches } from "@/server/batches/active";

export const metadata = { title: "Overview" };

const ACTION_PHRASES: Record<string, string> = {
  "batch.created": "opened a new batch",
  "batch.status_changed": "moved a batch to a new stage",
  "payment.marked_paid": "recorded a payment",
  "measurement.created": "entered a measurement",
  "measurement.updated": "changed a measurement",
  "allocation.approved": "approved shipping allocation",
};

function describeAction(action: string) {
  if (ACTION_PHRASES[action]) return ACTION_PHRASES[action];
  const [entity = "", verb = ""] = action.split(".");
  return `${verb.replace(/_/g, " ")} ${entity.replace(/_/g, " ")}`.trim();
}

export default async function AdminOverviewPage() {
  const [ordersToday, pendingInvoices, unallocatedBatches, revenue, activity, collecting] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: startOfLagosDay() } } }),
    db.invoice.count({ where: { status: "issued" } }),
    db.batch.count({ where: { status: { in: ["ordered", "measured"] }, allocations: { none: {} } } }),
    db.payment.aggregate({ where: { status: "success" }, _sum: { amount: true } }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { name: true, role: true } } },
    }),
    listActiveBatches(),
  ]);

  const stats = [
    { label: "Orders today", value: ordersToday.toString(), href: "/admin/orders" },
    { label: "Pending invoices", value: pendingInvoices.toString(), href: "/admin/invoices?status=issued" },
    {
      label: "Unallocated batches",
      value: unallocatedBatches.toString(),
      href: "/admin/batches",
      alert: unallocatedBatches > 0,
    },
    { label: "Revenue collected", value: formatMoney(revenue._sum.amount ?? "0"), href: "/admin/payments" },
  ];

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Overview</h1>

      <Card className="mt-6 grid grid-cols-2 divide-border max-sm:[&>*:nth-child(-n+2)]:border-b sm:grid-cols-4 sm:divide-x">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group min-w-0 p-4 hover:bg-muted/50 sm:p-5">
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              {stat.label}
              <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </p>
            <p className={`tabular mt-1 break-all text-xl font-semibold sm:text-2xl ${stat.alert ? "text-danger" : ""}`}>
              {stat.value}
            </p>
          </Link>
        ))}
      </Card>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="text-base font-semibold">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Admin changes are recorded here.</p>
          ) : (
            <ol className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{entry.actor?.name ?? "System"}</span>{" "}
                    <span className="text-muted-foreground">{describeAction(entry.action)}</span>
                  </span>
                  <time dateTime={entry.createdAt.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="text-base font-semibold">Collecting now</h2>
          {collecting.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No batch is open for orders.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {collecting.map((batch) => (
                <li key={batch.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{batch.name}</p>
                    <Badge tone="info" className="capitalize">
                      {batch.shipMethod}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cutoff {formatDate(batch.cutoffAt)} · {daysUntil(batch.cutoffAt)} days left
                  </p>
                  <p className="tabular mt-3 text-sm">
                    {batch.orderCount} orders from {batch.memberCount} customers
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
