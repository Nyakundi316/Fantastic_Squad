import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";
import { resendInvoices } from "@/server/invoices";

const bodySchema = z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(500) });

export const POST = route(async (req) => {
  const actor = await requireApiUser(req, "invoices.resend");
  const { invoiceIds } = await readJson(req, bodySchema);
  const result = await resendInvoices(invoiceIds, actor);
  await dispatchSoon();
  return NextResponse.json(result);
});
