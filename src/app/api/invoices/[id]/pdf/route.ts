import { requireApiUser } from "@/server/auth/api-user";
import { HttpError, route } from "@/server/http";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { getInvoiceForViewer, invoiceView } from "@/server/invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireApiUser(req);
  const invoice = await getInvoiceForViewer(params.id, user);
  if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice not found.");

  const pdf = await renderInvoicePdf(invoiceView(invoice));
  const filename = `${invoice.order.orderNumber}-${invoice.kind}-v${invoice.version}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
