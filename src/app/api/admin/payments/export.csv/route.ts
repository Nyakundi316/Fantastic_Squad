import { csvResponse, toCsv } from "@/lib/csv";
import { requireApiUser } from "@/server/auth/api-user";
import { route } from "@/server/http";
import { listLedger, parseLedgerFilters } from "@/server/payments/ledger";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireApiUser(req, "payments.export");
  const { rows } = await listLedger(parseLedgerFilters((k) => req.nextUrl.searchParams.get(k)), { all: true });

  const csv = toCsv(
    ["created_at", "paid_at", "order_number", "customer", "kind", "invoice_version", "method", "provider", "provider_ref", "status", "amount", "currency", "unapplied"],
    rows.map((p) => [
      p.createdAt.toISOString(),
      p.paidAt?.toISOString() ?? "",
      p.order.orderNumber,
      p.order.user.name ?? p.order.user.phone,
      p.kind,
      p.invoice?.version ?? "",
      p.method,
      p.provider ?? "",
      p.providerRef ?? "",
      p.status,
      p.amount.toFixed(2),
      p.currency,
      (p.metadata as { unapplied?: boolean } | null)?.unapplied ? "yes" : "",
    ]),
  );
  return csvResponse(`payments-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});
