import Link from "next/link";
import { Download } from "lucide-react";
import { OrderStatusBadge, ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/order-status";
import {
  ADMIN_ORDERS_PAGE_SIZE,
  listAdminOrders,
  parseAdminOrderFilters,
  productPaymentState,
} from "@/server/orders/admin-list";

export const metadata = { title: "Orders" };

const PAYMENT_BADGE = {
  paid: { tone: "success", label: "Paid" },
  pending: { tone: "warning", label: "Pending" },
  void: { tone: "neutral", label: "Void" },
} as const;

const selectClass =
  "h-10 rounded-lg border border-border bg-surface px-2.5 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const filters = parseAdminOrderFilters((key) => searchParams[key]);
  const [{ rows, total }, batches] = await Promise.all([
    listAdminOrders(filters),
    db.batch.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, name: true } }),
  ]);

  const query = new URLSearchParams(
    Object.entries({ ...filters, page: undefined }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_ORDERS_PAGE_SIZE));
  const pageHref = (page: number) => `/admin/orders?${new URLSearchParams({ ...Object.fromEntries(query), page: String(page) })}`;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="tabular mt-1 text-sm text-muted-foreground">{total} matching</p>
        </div>
        <a
          href={`/api/admin/orders/export.csv?${query}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </a>
      </div>

      <form className="mt-5 flex flex-wrap items-end gap-2" action="/admin/orders">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground sm:max-w-xs">
          Search
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="FZ-1042, name, phone"
            className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">Any</option>
            {Object.entries(ORDER_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Product payment
          <select name="payment" defaultValue={filters.payment ?? ""} className={selectClass}>
            <option value="">Any</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Pending</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Method
          <select name="shipMethod" defaultValue={filters.shipMethod ?? ""} className={selectClass}>
            <option value="">Any</option>
            <option value="sea">Sea</option>
            <option value="air">Air</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Batch
          <select name="batchId" defaultValue={filters.batchId ?? ""} className={`${selectClass} max-w-[200px]`}>
            <option value="">Any</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg bg-foreground px-4 text-sm font-medium text-surface hover:bg-foreground/90">
          Apply
        </button>
        {query.size > 0 && (
          <Link href="/admin/orders" className="h-10 px-2 text-sm leading-10 text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      <div className="mt-5 overflow-auto rounded-xl border border-border bg-surface lg:max-h-[calc(100dvh-260px)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Batch</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Product payment</th>
              <th className="px-4 py-3 text-right font-medium">Items</th>
              <th className="px-4 py-3 text-right font-medium">Product total</th>
              <th className="px-4 py-3 text-right font-medium">Placed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((order) => {
              const payment = PAYMENT_BADGE[productPaymentState(order)];
              return (
                <tr key={order.id} className="hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${order.id}`} className="tabular font-medium text-primary hover:underline">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{order.user.name ?? "No name"}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {order.user.phone ?? order.user.email}
                      {order.user.role === "dropshipper" && " · Dropshipper"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <ShipMethodBadge method={order.shipMethod} />
                      <span className="truncate text-muted-foreground">{order.batch?.name ?? "Unassigned"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={payment.tone}>{payment.label}</Badge>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{order._count.items}</td>
                  <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(order.productTotal)}</td>
                  <td className="tabular px-4 py-3 text-right text-muted-foreground">{formatDate(order.createdAt, { day: "numeric", month: "short" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No orders match these filters.</p>}
      </div>

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center gap-4 text-sm" aria-label="Pages">
          {filters.page > 1 && (
            <Link href={pageHref(filters.page - 1)} className="text-primary hover:underline">
              Previous
            </Link>
          )}
          <span className="tabular text-muted-foreground">
            Page {filters.page} of {pageCount}
          </span>
          {filters.page < pageCount && (
            <Link href={pageHref(filters.page + 1)} className="text-primary hover:underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
