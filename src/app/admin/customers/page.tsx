import Link from "next/link";
import { Prisma } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Customers" };

type Row = { id: string; name: string | null; phone: string | null; email: string | null; role: string; orders: bigint; spent: Prisma.Decimal | null; last_order: Date | null };

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_]/g, "")}%` : null;

  // Spent = paid invoices (product and shipping) across live orders.
  const rows = await db.$queryRaw<Row[]>`
    SELECT u.id, u.name, u.phone, u.email, u.role::text AS role,
           COUNT(DISTINCT o.id) FILTER (WHERE o.status <> 'cancelled') AS orders,
           SUM(i.amount) FILTER (WHERE i.status = 'paid') AS spent,
           MAX(o.created_at) AS last_order
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    LEFT JOIN invoices i ON i.order_id = o.id
    WHERE u.role IN ('customer', 'dropshipper')
      ${like ? Prisma.sql`AND (u.name ILIKE ${like} OR u.phone ILIKE ${like} OR u.email ILIKE ${like})` : Prisma.empty}
    GROUP BY u.id
    ORDER BY MAX(o.created_at) DESC NULLS LAST, u.created_at DESC
    LIMIT 200`;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <form action="/admin/customers">
          <label className="sr-only" htmlFor="customer-search">
            Search customers
          </label>
          <input
            id="customer-search"
            name="q"
            defaultValue={q}
            placeholder="Name, phone or email"
            className="h-10 w-64 rounded-lg border border-border bg-surface px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </form>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 text-right font-medium">Orders</th>
              <th className="px-4 py-3 text-right font-medium">Paid to date</th>
              <th className="px-4 py-3 text-right font-medium">Last order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/60">
                <td className="px-4 py-3">
                  <Link href={`/admin/customers/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.name ?? "No name"}
                  </Link>
                  {c.role === "dropshipper" && (
                    <Badge tone="accent" className="ml-2">
                      Dropshipper
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="tabular">{c.phone}</span>
                  {c.email && <span className="block text-xs">{c.email}</span>}
                </td>
                <td className="tabular px-4 py-3 text-right">{Number(c.orders)}</td>
                <td className="tabular px-4 py-3 text-right">{formatMoney(c.spent ? new Prisma.Decimal(c.spent) : "0")}</td>
                <td className="tabular px-4 py-3 text-right text-muted-foreground">{c.last_order ? formatDate(c.last_order) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No customers match.</p>}
      </div>
    </div>
  );
}
