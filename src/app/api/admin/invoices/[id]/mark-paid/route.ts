import { NextResponse } from "next/server";
import { dispatchSoon } from "@/server/notifications/dispatch";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { writeAudit } from "@/server/audit";
import { assertUuid, readJson, route } from "@/server/http";
import { lockInvoice, settleInvoice } from "@/server/payments/settle";

const bodySchema = z.object({
  method: z.enum(["bank_transfer", "manual"]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Finance confirms an offline payment (bank transfer, cash) against an issued invoice. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireApiUser(req, "payments.mark_paid");
  assertUuid(params.id, "Invoice");
  const { method, reference, note } = await readJson(req, bodySchema);

  const payment = await db.$transaction(async (tx) => {
    const invoice = await lockInvoice(tx, params.id);
    const payment = await settleInvoice(tx, invoice, {
      method,
      metadata: { recordedBy: actor.id, ...(reference ? { reference } : {}), ...(note ? { note } : {}) },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "payment.marked_paid",
      entityType: "invoice",
      entityId: invoice.id,
      before: { status: invoice.status },
      after: {
        status: "paid",
        paymentId: payment.id,
        orderNumber: invoice.order.orderNumber,
        kind: invoice.kind,
        amount: invoice.amount.toFixed(2),
        method,
        reference: reference ?? null,
      },
    });
    return payment;
  });

  await dispatchSoon();
  return NextResponse.json({ payment: { id: payment.id, status: payment.status, amount: payment.amount.toFixed(2) } });
});
