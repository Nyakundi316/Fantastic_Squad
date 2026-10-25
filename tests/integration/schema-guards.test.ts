import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase } from "./db";

async function orderFixture() {
  const user = await db.user.create({ data: { phone: "+2348030009999" } });
  const product = await db.product.create({
    data: { title: "Test product", variants: { create: { label: "Std", buyingPrice: new Prisma.Decimal("1000.00") } } },
    include: { variants: true },
  });
  const batch = await db.batch.create({ data: { name: "Test batch", cutoffAt: new Date(Date.now() + 86_400_000) } });
  const order = await db.order.create({
    data: {
      userId: user.id,
      batchId: batch.id,
      productTotal: new Prisma.Decimal("2000.00"),
      items: {
        create: {
          productId: product.id,
          variantId: product.variants[0]!.id,
          quantity: 2,
          unitPrice: new Prisma.Decimal("1000.00"),
          lineTotal: new Prisma.Decimal("2000.00"),
        },
      },
    },
    include: { items: true },
  });
  return { user, batch, order };
}

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("orders", () => {
  it("numbers orders FZ-1001, FZ-1002, … and computes grand_total in the database", async () => {
    const { order, user } = await orderFixture();
    expect(order.orderNumber).toBe("FZ-1001");
    expect(order.grandTotal.toFixed(2)).toBe("2000.00");

    const updated = await db.order.update({ where: { id: order.id }, data: { shippingTotal: new Prisma.Decimal("750.25") } });
    expect(updated.grandTotal.toFixed(2)).toBe("2750.25");

    const second = await db.order.create({ data: { userId: user.id } });
    expect(second.orderNumber).toBe("FZ-1002");
  });

  it("refuses non-positive quantities and weights", async () => {
    const { order } = await orderFixture();
    const item = order.items[0]!;
    await expect(db.orderItem.update({ where: { id: item.id }, data: { quantity: 0 } })).rejects.toThrow();
    await expect(db.measurement.create({ data: { orderItemId: item.id, weightG: 0 } })).rejects.toThrow();
    await expect(db.measurement.create({ data: { orderItemId: item.id, weightG: 450 } })).resolves.toBeTruthy();
  });
});

describe("invoice immutability (hard rule 3)", () => {
  it("allows status and paid_at to change but nothing else, and never deletes", async () => {
    const { order } = await orderFixture();
    const invoice = await db.invoice.create({
      data: { orderId: order.id, kind: "product", amount: new Prisma.Decimal("2000.00"), breakdown: {} },
    });

    await expect(
      db.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date() } }),
    ).resolves.toMatchObject({ status: "paid" });

    await expect(db.invoice.update({ where: { id: invoice.id }, data: { amount: new Prisma.Decimal("1.00") } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.invoice.update({ where: { id: invoice.id }, data: { breakdown: { hacked: true } } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(/immutable/);
  });

  it("supports adjustments as a new version that supersedes the old one", async () => {
    const { order } = await orderFixture();
    const v1 = await db.invoice.create({
      data: { orderId: order.id, kind: "shipping", amount: new Prisma.Decimal("5000.00"), breakdown: {} },
    });
    const v2 = await db.invoice.create({
      data: { orderId: order.id, kind: "shipping", version: 2, supersedesId: v1.id, amount: new Prisma.Decimal("4800.00"), breakdown: {} },
    });
    await db.invoice.update({ where: { id: v1.id }, data: { status: "adjusted" } });
    expect(v2.supersedesId).toBe(v1.id);

    await expect(
      db.invoice.create({ data: { orderId: order.id, kind: "shipping", version: 2, amount: new Prisma.Decimal("1.00"), breakdown: {} } }),
    ).rejects.toThrow();
  });
});

describe("approved allocations are immutable", () => {
  it("blocks update and delete once approved_at is set", async () => {
    const { order, batch } = await orderFixture();
    const allocation = await db.shippingAllocation.create({
      data: {
        batchId: batch.id,
        orderId: order.id,
        method: "weight",
        shippingQuote: new Prisma.Decimal("10000.00"),
        totalBatchWeightG: 900,
        orderWeightG: 900,
        allocatedAmount: new Prisma.Decimal("10000.00"),
        calculatedAt: new Date(),
        approvedAt: new Date(),
      },
    });

    await expect(
      db.shippingAllocation.update({ where: { id: allocation.id }, data: { allocatedAmount: new Prisma.Decimal("1.00") } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.shippingAllocation.delete({ where: { id: allocation.id } })).rejects.toThrow(/immutable/);
  });
});

describe("payments", () => {
  it("allows one row per provider reference (webhook idempotency)", async () => {
    const { order } = await orderFixture();
    const data = {
      orderId: order.id,
      kind: "shipping" as const,
      amount: new Prisma.Decimal("100.00"),
      method: "card" as const,
      provider: "paystack" as const,
      providerRef: "ref_123",
    };
    await db.payment.create({ data });
    await expect(db.payment.create({ data })).rejects.toThrow();
    // Manual payments carry no provider ref and are unaffected.
    await db.payment.create({ data: { ...data, method: "manual", provider: null, providerRef: null } });
    await db.payment.create({ data: { ...data, method: "manual", provider: null, providerRef: null } });
  });
});
