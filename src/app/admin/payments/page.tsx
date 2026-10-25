import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireStaffViewer } from "@/server/auth/viewer";
import { LEDGER_PAGE_SIZE, listLedger, parseLedgerFilters } from "@/server/payments/ledger";

export const metadata = { title: "Payments" };

const STATUS_TONE = { pending: "warning", success: "success", failed: "danger", refunded: "neutral" } as const;
const selectClass = "h-10 rounded-lg border border-border bg-surface px-2.5 text-sm";

export default async function PaymentsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const staff = await requireStaffViewer("/admin/payments");
  const filters = parseLedgerFilters((k) => searchParams[k]);
  const { rows, total, received } = await listLedger(filters);
  const query = new URLSearchParams(
    Object.entries(searchParams).filter((e): e is [string, string] => Boolean(e[1]) && e[0] !== "page"),
  );
  const pageCount = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));

  return (
    <div className="max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            {total} payments · {formatMoney(received)} received in this view
          </p>
        </div>
        {can(staff.role, "payments.export") && (
          <a
            href={`/api/admin/payments/export.csv?${query}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-muted"
          >
            <Download className="size-4" aria-hidden />
            Export CSV
          </a>
        )}
      </div>

      <form action="/admin/payments" className="mt-5 flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
        <label className="flex flex-col gap-1">
          Search
          <input name="q" defaultValue={filters.q} placeholder="FZ-1042 or reference" className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Kind
          <select name="kind" defaultValue={filters.kind ?? ""} className={selectClass}>
            <option value="">Any</option>
            <option value="product">Product</option>
            <option value="shipping">Shipping</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Method
          <select name="method" defaultValue={filters.method ?? ""} className={selectClass}>
            <option value="">Any</option>
            <option value="card">Card (Paystack)</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="manual">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={searchParams.from} className={selectClass} />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={searchParams.to} className={selectClass} />
        </label>
        <button className="h-10 rounded-lg bg-foreground px-4 text-sm font-medium text-surface">Apply</button>
      </form>

      <div className="mt-5 overflow-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => {
              const unapplied = (p.metadata as { unapplied?: boolean } | null)?.unapplied;
              return (
                <tr key={p.id} className="hover:bg-muted/60">
                  <td className="tabular px-4 py-3 text-muted-foreground">{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${p.order.id}`} className="tabular font-medium text-primary hover:underline">
                      {p.order.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{p.order.user.name ?? p.order.user.phone}</span>
                  </td>
                  <td className="px-4 py-3 capitalize">{p.kind}</td>
                  <td className="px-4 py-3">{p.method === "card" ? "Card" : p.method === "bank_transfer" ? "Bank transfer" : "Other"}</td>
                  <td className="tabular max-w-[180px] truncate px-4 py-3 text-xs text-muted-foreground">{p.providerRef ?? "–"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[p.status]} className="capitalize">
                      {p.status}
                    </Badge>
                    {unapplied && (
                      <Badge tone="danger" className="ml-1">
                        Unapplied
                      </Badge>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(p.amount, p.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No payments match.</p>}
      </div>
      {pageCount > 1 && (
        <p className="tabular mt-3 text-sm text-muted-foreground">
          Page {filters.page} of {pageCount}
          {filters.page < pageCount && (
            <Link className="ml-3 text-primary hover:underline" href={`/admin/payments?${new URLSearchParams({ ...Object.fromEntries(query), page: String(filters.page + 1) })}`}>
              Next
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
