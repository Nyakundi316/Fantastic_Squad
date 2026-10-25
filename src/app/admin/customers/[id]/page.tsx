import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { OrderStatusBadge, ShipMethodBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const customer = await db.user.findUnique({
    where: { id: params.id },
    include: {
      addresses: { orderBy: { isDefault: "desc" } },
      orders: { orderBy: { createdAt: "desc" }, include: { batch: { select: { name: true } }, _count: { select: { items: true } } } },
      notifications: { orderBy: { createdAt: "desc" }, take: 15, where: { channel: { not: "in_app" } } },
    },
  });
  if (!customer) notFound();

  return (
    <div className="max-w-6xl">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Customers
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{customer.name ?? "No name"}</h1>
        <Badge tone="accent" className="capitalize">
          {customer.role}
        </Badge>
      </div>
      <p className="tabular mt-1 text-sm text-muted-foreground">
        {customer.phone}
        {customer.email && ` · ${customer.email}`} · joined {formatDate(customer.createdAt)}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="text-base font-semibold">Order history</h2>
          <div className="mt-3 overflow-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Product</th>
                  <th className="px-4 py-3 text-right font-medium">Shipping</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.orders.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="tabular font-medium text-primary hover:underline">
                        {o.orderNumber}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <ShipMethodBadge method={o.shipMethod} />
                        <span className="text-muted-foreground">{o.batch?.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">{formatMoney(o.productTotal)}</td>
                    <td className="tabular px-4 py-3 text-right">{o.shippingTotal.isZero() ? "–" : formatMoney(o.shippingTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {customer.orders.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No orders yet.</p>}
          </div>
        </section>

        <div className="space-y-6">
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">Addresses</h2>
            {customer.addresses.length === 0 && <p className="mt-2 text-muted-foreground">None saved.</p>}
            <ul className="mt-2 space-y-3">
              {customer.addresses.map((a) => (
                <li key={a.id}>
                  <p className="font-medium">{a.fullName}</p>
                  <p className="text-muted-foreground">{[a.line1, a.line2, a.city, a.state].filter(Boolean).join(", ")}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">Messages sent</h2>
            <ul className="mt-2 space-y-2">
              {customer.notifications.map((n) => (
                <li key={n.id} className="flex items-baseline justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{n.template}</span> <span className="text-muted-foreground">· {n.channel}</span>
                  </span>
                  <span className={n.status === "failed" ? "text-xs text-danger" : "text-xs text-muted-foreground"} title={n.error ?? undefined}>
                    {n.status === "sent" && n.sentAt ? formatDateTime(n.sentAt) : n.status}
                  </span>
                </li>
              ))}
              {customer.notifications.length === 0 && <li className="text-muted-foreground">None.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
