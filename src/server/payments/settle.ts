import type { BatchStatus, Invoice, OrderStatus, Payment, PaymentMethod, PaymentProvider, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { HttpError } from "@/server/http";
import { queueNotification } from "@/server/notifications/queue";

type Settlement = {
  method: PaymentMethod;
  provider?: PaymentProvider | null;
  providerRef?: string | null;
  metadata?: Prisma.InputJsonObject;
  paidAt?: Date;
  /** A pending provider payment to mark successful instead of creating a new row. */
  pendingPayment?: Payment;
};

export type LockedInvoice = Invoice & {
  order: {
    id: string;
    status: OrderStatus;
    orderNumber: string;
    user: { id: string; name: string | null; email: string | null; phone: string | null };
    batch: { status: BatchStatus } | null;
  };
};

/** Locks the invoice row so two settlements of the same invoice serialise. */
export async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<LockedInvoice> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          orderNumber: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
          batch: { select: { status: true } },
        },
      },
    },
  });
  if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice not found.");
  return invoice;
}

/**
 * Where a shipping-invoiced order goes once paid. If the batch already left,
 * its goods were held at the destination, so paying releases them as Shipped.
 */
function statusAfterShippingPaid(batchStatus: BatchStatus | undefined): OrderStatus {
  return batchStatus === "shipped" || batchStatus === "delivered" ? "shipped" : "shipping_paid";
}

/**
 * Records a successful payment against an issued invoice, marks the invoice paid
 * and moves the order on. Shared by manual mark-paid and provider webhooks.
 * Call inside a transaction after lockInvoice.
 */
export async function settleInvoice(tx: Prisma.TransactionClient, invoice: LockedInvoice, settlement: Settlement) {
  if (invoice.status !== "issued") {
    throw new HttpError(409, "invoice_not_payable", `This invoice is already ${invoice.status === "paid" ? "paid" : invoice.status}.`);
  }
  if (invoice.order.status === "cancelled") {
    throw new HttpError(409, "order_cancelled", "This order was cancelled.");
  }

  const paidAt = settlement.paidAt ?? new Date();
  const payment = settlement.pendingPayment
    ? await tx.payment.update({
        where: { id: settlement.pendingPayment.id },
        data: {
          status: "success",
          paidAt,
          metadata: { ...(settlement.pendingPayment.metadata as Prisma.JsonObject), ...settlement.metadata },
        },
      })
    : await tx.payment.create({
        data: {
          orderId: invoice.orderId,
          invoiceId: invoice.id,
          kind: invoice.kind,
          amount: invoice.amount,
          currency: invoice.currency,
          method: settlement.method,
          provider: settlement.provider ?? null,
          providerRef: settlement.providerRef ?? null,
          status: "success",
          paidAt,
          metadata: settlement.metadata ?? {},
        },
      });
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt } });

  const vars = {
    name: invoice.order.user.name ?? "there",
    orderNumber: invoice.order.orderNumber,
    amount: formatMoney(invoice.amount, invoice.currency),
  };

  if (invoice.kind === "shipping") {
    if (invoice.order.status === "invoiced") {
      await tx.order.update({ where: { id: invoice.orderId }, data: { status: statusAfterShippingPaid(invoice.order.batch?.status) } });
    }
    await queueNotification(tx, { userId: invoice.order.user.id, template: "shipping_paid", vars, link: `/orders/${invoice.order.id}` });
  } else {
    await queueNotification(tx, { userId: invoice.order.user.id, template: "order_received", vars, link: `/orders/${invoice.order.id}` });
  }

  return payment;
}
