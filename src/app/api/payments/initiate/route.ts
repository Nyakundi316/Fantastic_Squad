import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/api-user";
import { readJson, route } from "@/server/http";
import { initiatePayment } from "@/server/payments/card";

const bodySchema = z.object({ invoiceId: z.string().uuid(), provider: z.string().max(20).default("paystack") });

export const POST = route(async (req) => {
  const user = await requireApiUser(req);
  const { invoiceId, provider } = await readJson(req, bodySchema);
  const { checkoutUrl, reference } = await initiatePayment(invoiceId, user, provider);
  return NextResponse.json({ checkoutUrl, reference });
});
