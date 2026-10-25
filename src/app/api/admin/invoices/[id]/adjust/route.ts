import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { assertUuid, readJson, route } from "@/server/http";
import { adjustInvoice } from "@/server/invoices";

const bodySchema = z.object({
  amount: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 4500.00")
    .refine((v) => !/^0+(\.0+)?$/.test(v), "To waive an invoice, mark it paid with a note instead."),
  reason: z.string().trim().min(5, "Say why the invoice is changing.").max(300),
});

export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "invoices.adjust");
  const input = await readJson(req, bodySchema);
  const invoice = await adjustInvoice(assertUuid(params.id, "Invoice"), input, actor);
  await dispatchSoon();
  return NextResponse.json({ invoice: { id: invoice.id, version: invoice.version, amount: invoice.amount.toFixed(2), supersedesId: invoice.supersedesId } }, { status: 201 });
});
