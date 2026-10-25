import { randomBytes } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { initializeTransaction, paystackConfigured } from "./paystack";
import { lockInvoice, settleInvoice } from "./settle";

/** Creates a pending payment with a unique reference and returns the provider's checkout URL. */
export async function initiatePayment(invoiceId: string, user: Pick<User, "id" | "email" | "phone">, provider: string) {
  if (provider !== "paystack") {
    throw new HttpError(422, "provider_unavailable", "That payment provider is not available. Pay by card with Paystack or by bank transfer.");
  }
  if (!paystackConfigured()) {
    throw new HttpError(503, "card_payments_unavailable", "Card payments are not available right now. Please pay by bank transfer.");
  }

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { order: { select: { userId: true, orderNumber: true, status: true } } },
  });
  if (!invoice || invoice.order.userId !== user.id) throw new HttpError(404, "invoice_not_found", "Invoice not found.");
  if (invoice.status !== "issued") throw new HttpError(409, "invoice_not_payable", `This invoice is already ${invoice.status === "paid" ? "paid" : invoice.status}.`);
  if (invoice.order.status === "cancelled") throw new HttpError(409, "order_cancelled", "This order was cancelled.");

  const reference = `${invoice.order.orderNumber}-${invoice.kind === "shipping" ? "S" : "P"}${invoice.version}-${randomBytes(4).toString("hex")}`;
  const payment = await db.payment.create({
    data: {
      orderId: invoice.orderId,
      invoiceId: invoice.id,
      kind: invoice.kind,
      amount: invoice.amount,
      currency: invoice.currency,
      method: "card",
      provider: "paystack",
      providerRef: reference,
      status: "pending",
      metadata: { initiatedBy: user.id },
    },
  });

  const callback = new URL(`/invoices/${invoice.id}`, env().APP_URL);
  callback.searchParams.set("reference", reference);

  try {
    const init = await initializeTransaction({
      // Paystack needs an email; phone-only customers get a non-delivering placeholder.
      email: user.email ?? `${(user.phone ?? user.id).replace(/\D/g, "")}@customers.fantasticzone.ng`,
      amountKobo: invoice.amount.mul(100).toFixed(0),
      reference,
      currency: invoice.currency,
      callbackUrl: callback.toString(),
      metadata: { invoiceId: invoice.id, orderNumber: invoice.order.orderNumber, kind: invoice.kind },
    });
    return { checkoutUrl: init.authorizationUrl, reference };
  } catch (err) {
    console.error("[paystack] initialize", err);
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "failed", metadata: { initiatedBy: user.id, error: err instanceof Error ? err.message : "unknown" } },
    });
    throw new HttpError(502, "payment_provider_error", "We couldn't reach the payment provider. Try again, or pay by bank transfer.");
  }
}

type PaystackCharge = { reference?: unknown; amount?: unknown; currency?: unknown; id?: unknown; channel?: unknown; paid_at?: unknown };
export type ChargeOutcome = "settled" | "duplicate" | "unknown_reference" | "amount_mismatch" | "unapplied";

/**
 * Applies a verified charge.success. Idempotent by provider reference (hard rule 6):
 * the payment row is locked, and a payment that is already successful is left alone.
 */
export async function applyPaystackCharge(data: PaystackCharge): Promise<ChargeOutcome> {
  const reference = typeof data.reference === "string" ? data.reference : "";
  if (!reference) return "unknown_reference";

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM payments WHERE provider = 'paystack' AND provider_ref = ${reference} FOR UPDATE`;
    if (rows.length === 0) return "unknown_reference";

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: rows[0]!.id } });
    if (payment.status === "success") return "duplicate";

    const providerMeta: Prisma.InputJsonObject = {
      paystackId: String(data.id ?? ""),
      channel: String(data.channel ?? ""),
      providerPaidAt: String(data.paid_at ?? ""),
    };
    const expectedKobo = payment.amount.mul(100).toFixed(0);
    if (String(data.amount) !== expectedKobo || String(data.currency).toUpperCase() !== payment.currency) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          metadata: { ...(payment.metadata as Prisma.JsonObject), ...providerMeta, mismatch: { amount: String(data.amount), currency: String(data.currency), expectedKobo } },
        },
      });
      await writeAudit(tx, { actorId: null, action: "payment.amount_mismatch", entityType: "payment", entityId: payment.id, after: { reference, amount: String(data.amount) } });
      return "amount_mismatch";
    }

    const paidAt = typeof data.paid_at === "string" && !Number.isNaN(Date.parse(data.paid_at)) ? new Date(data.paid_at) : new Date();
    const invoice = await lockInvoice(tx, payment.invoiceId!);

    if (invoice.status !== "issued" || invoice.order.status === "cancelled") {
      // Money arrived for an invoice that no longer takes payment. Keep it on record for finance to refund or reapply.
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "success", paidAt, metadata: { ...(payment.metadata as Prisma.JsonObject), ...providerMeta, unapplied: true, invoiceStatus: invoice.status } },
      });
      await writeAudit(tx, { actorId: null, action: "payment.unapplied", entityType: "payment", entityId: payment.id, after: { reference, invoiceStatus: invoice.status } });
      return "unapplied";
    }

    await settleInvoice(tx, invoice, { method: "card", pendingPayment: payment, metadata: providerMeta, paidAt });
    await writeAudit(tx, {
      actorId: null,
      action: "payment.webhook_settled",
      entityType: "invoice",
      entityId: invoice.id,
      before: { status: "issued" },
      after: { status: "paid", paymentId: payment.id, reference, provider: "paystack" },
    });
    return "settled";
  });
}
