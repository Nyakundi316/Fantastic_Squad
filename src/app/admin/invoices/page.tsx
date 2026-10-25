import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { requireStaffViewer } from "@/server/auth/viewer";
import { InvoiceTable } from "./resend-form";

export const metadata = { title: "Invoices" };

const STATUS_TABS: Array<{ key: InvoiceStatus | "all"; label: string }> = [
  { key: "issued", label: "Unpaid" },
  { key: "paid", label: "Paid" },
  { key: "adjusted", label: "Replaced" },
  { key: "voided", label: "Voided" },
  { key: "all", label: "All" },
];

export default async function AdminInvoicesPage({ searchParams }: { searchParams: { status?: string; kind?: string } }) {
  const staff = await requireStaffViewer("/admin/invoices");
  const status = STATUS_TABS.find((t) => t.key === searchParams.status)?.key ?? "issued";
  const kind = searchParams.kind === "product" || searchParams.kind === "shipping" ? searchParams.kind : undefined;

  const where: Prisma.InvoiceWhereInput = { ...(status !== "all" ? { status } : {}), ...(kind ? { kind } : {}) };
  const [invoices, overdue] = await Promise.all([
    db.invoice.findMany({
      where,
      include: { order: { select: { id: true, orderNumber: true, user: { select: { name: true, phone: true } } } } },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    db.invoice.count({ where: { status: "issued", dueAt: { lt: new Date() } } }),
  ]);

  const href = (changes: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ status, kind, ...changes }).filter((e): e is [string, string] => Boolean(e[1])));
    return `/admin/invoices?${q}`;
  };

  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Invoices</h1>
      {overdue > 0 && <p className="mt-1 text-sm text-warning">{overdue} unpaid {overdue === 1 ? "invoice is" : "invoices are"} past due.</p>}

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <nav className="flex gap-1 text-sm" aria-label="Status">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.key}
              href={href({ status: t.key })}
              aria-current={status === t.key ? "page" : undefined}
              className={cn("rounded-lg px-3 py-1.5", status === t.key ? "bg-foreground text-surface" : "text-muted-foreground hover:bg-muted")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <nav className="flex gap-3 text-sm" aria-label="Kind">
          {[undefined, "shipping", "product"].map((k) => (
            <Link key={k ?? "any"} href={href({ kind: k })} className={cn(kind === k ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {k === undefined ? "All kinds" : k === "shipping" ? "Shipping" : "Product"}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-5">
        <InvoiceTable
          canResend={can(staff.role, "invoices.resend")}
          rows={invoices.map((inv) => ({
            id: inv.id,
            label: `${inv.kind === "shipping" ? "Shipping" : "Product"}${inv.version > 1 ? ` v${inv.version}` : ""}`,
            orderId: inv.order.id,
            orderNumber: inv.order.orderNumber,
            customer: inv.order.user.name ?? inv.order.user.phone ?? "",
            amount: formatMoney(inv.amount, inv.currency),
            status: INVOICE_STATUS[inv.status],
            issued: formatDate(inv.issuedAt, { day: "numeric", month: "short" }),
            due: inv.dueAt ? formatDate(inv.dueAt, { day: "numeric", month: "short" }) : "–",
            resendable: inv.kind === "shipping" && inv.status === "issued",
          }))}
        />
      </div>
    </div>
  );
}
