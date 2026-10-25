import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/roles";
import { lockOpenBatchFor } from "@/server/batches/active";
import { HttpError } from "@/server/http";

export const CUSTOMER_LINE_LIMIT = 20;
export const BULK_LINE_LIMIT = 500;
const PRODUCT_INVOICE_DUE_MS = 48 * 60 * 60 * 1000;

export const placeOrderSchema = z.object({
  items: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(BULK_LINE_LIMIT) }))
    .min(1, "Add at least one item.")
    .max(30),
  shipMethod: z.enum(["sea", "air"]),
  addressId: z.string().uuid("Choose a delivery address."),
  acknowledgedShippingLater: z.literal(true),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/**
 * Hard rule 4 lives in the route (explicit 422 before anything else). Everything
 * priced here comes from the database; nothing the client sends about money is read.
 */
export async function placeOrder(user: User, input: PlaceOrderInput, now = new Date()) {
  const lineLimit = can(user.role, "orders.bulk") ? BULK_LINE_LIMIT : CUSTOMER_LINE_LIMIT;

  const quantities = new Map<string, number>();
  for (const item of input.items) quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
  for (const quantity of quantities.values()) {
    if (quantity > lineLimit) {
      throw new HttpError(422, "quantity_limit", `You can order up to ${lineLimit} of each item.`, { limit: lineLimit });
    }
  }

  return db.$transaction(async (tx) => {
    const address = await tx.address.findFirst({ where: { id: input.addressId, userId: user.id } });
    if (!address) throw new HttpError(422, "invalid_address", "Choose one of your saved delivery addresses.");

    const variants = await tx.productVariant.findMany({
      where: { id: { in: [...quantities.keys()] }, isActive: true, product: { isActive: true } },
      include: { product: { select: { id: true, title: true } } },
    });
    if (variants.length !== quantities.size) {
      throw new HttpError(422, "item_unavailable", "One of the items is no longer available. Review your cart and try again.");
    }

    const batch = await lockOpenBatchFor(tx, input.shipMethod);
    if (!batch) {
      throw new HttpError(409, "no_open_batch", `There is no ${input.shipMethod} batch open right now. Choose another shipping method.`);
    }

    const lines = variants.map((variant) => {
      const quantity = quantities.get(variant.id)!;
      return { variant, quantity, unitPrice: variant.buyingPrice, lineTotal: variant.buyingPrice.mul(quantity) };
    });
    const productTotal = lines.reduce((sum, l) => sum.add(l.lineTotal), new Prisma.Decimal(0));

    const order = await tx.order.create({
      data: {
        userId: user.id,
        batchId: batch.id,
        shipMethod: input.shipMethod,
        productTotal,
        shipAddressId: address.id,
        items: {
          create: lines.map((l) => ({
            productId: l.variant.product.id,
            variantId: l.variant.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { items: true },
    });

    const dueAt = new Date(Math.min(now.getTime() + PRODUCT_INVOICE_DUE_MS, batch.cutoff_at.getTime()));
    await tx.invoice.create({
      data: {
        orderId: order.id,
        kind: "product",
        amount: productTotal,
        currency: process.env.CURRENCY ?? "NGN",
        issuedAt: now,
        dueAt,
        breakdown: {
          kind: "product",
          lines: lines.map((l) => ({
            title: l.variant.product.title,
            variant: l.variant.label,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toFixed(2),
            lineTotal: l.lineTotal.toFixed(2),
          })),
          total: productTotal.toFixed(2),
          note: "Product price only. Shipping is invoiced separately after measurement.",
        },
      },
    });

    return { order, batch: { id: batch.id, name: batch.name, cutoffAt: batch.cutoff_at } };
  });
}
