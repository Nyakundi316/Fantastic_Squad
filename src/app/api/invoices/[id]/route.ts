import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/api-user";
import { HttpError, route } from "@/server/http";
import { getInvoiceForViewer, invoiceView } from "@/server/invoices";

export const dynamic = "force-dynamic";

export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireApiUser(req);
  const invoice = await getInvoiceForViewer(params.id, user);
  if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice not found.");
  const view = invoiceView(invoice);

  return NextResponse.json({
    invoice: {
      id: view.id,
      kind: view.kind,
      version: view.version,
      status: view.status,
      amount: view.amount,
      currency: view.currency,
      issuedAt: view.issuedAt.toISOString(),
      dueAt: view.dueAt?.toISOString() ?? null,
      paidAt: view.paidAt?.toISOString() ?? null,
      orderNumber: view.order.orderNumber,
      supersedesId: view.supersedes?.id ?? null,
      ...(view.kind === "shipping" ? { breakdown: view.shipping, items: view.items } : { breakdown: view.product }),
    },
  });
});
