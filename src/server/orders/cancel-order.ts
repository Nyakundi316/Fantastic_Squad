import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/server/http";

/** Customers can cancel while the order is still a preorder and the product price is unpaid. */
export async function cancelOrder(orderId: string, user: Pick<User, "id">) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders WHERE id = ${orderId}::uuid AND user_id = ${user.id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new HttpError(404, "order_not_found", "Order not found.");

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { invoices: true } });
    if (order.status !== "preorder_placed") {
      throw new HttpError(409, "not_cancellable", "This order is already with the supplier and can no longer be cancelled.");
    }

    const productInvoice = order.invoices.find((i) => i.kind === "product" && i.status !== "adjusted");
    if (productInvoice?.status === "paid") {
      throw new HttpError(409, "order_paid", "This order is paid. Contact support to cancel it and arrange a refund.");
    }
    if (productInvoice?.status === "issued") {
      await tx.invoice.update({ where: { id: productInvoice.id }, data: { status: "voided" } });
    }

    return tx.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
  });
}
