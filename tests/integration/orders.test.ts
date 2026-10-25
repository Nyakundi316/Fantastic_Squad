import { Prisma } from "@prisma/client";
import type { NextResponse } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cancelRoute } from "@/app/api/orders/[id]/cancel/route";
import { GET as getOrderRoute } from "@/app/api/orders/[id]/route";
import { GET as listOrdersRoute, POST as createOrderRoute } from "@/app/api/orders/route";
import { CART_COOKIE } from "@/server/cart";
import { db, resetDatabase } from "./db";
import { createAddress, createBatch, createUser, request, shopFixture } from "./fixtures";

const noParams = { params: {} };
const orderBody = (variantId: string, addressId: string, extra: Record<string, unknown> = {}) => ({
  items: [{ variantId, quantity: 2 }],
  shipMethod: "sea",
  addressId,
  acknowledgedShippingLater: true,
  ...extra,
});

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("POST /api/orders: shipping acknowledgement (hard rule 4)", () => {
  it.each([
    ["missing", undefined],
    ["false", false],
    ["the string 'true'", "true"],
    ["1", 1],
  ])("rejects when acknowledgedShippingLater is %s", async (_label, ack) => {
    const { customer, address, cheap } = await shopFixture();
    const body = orderBody(cheap.id, address.id, { acknowledgedShippingLater: ack });
    const res = await createOrderRoute(await request("/api/orders", { body, user: customer }), noParams);

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("shipping_ack_required");
    expect(await db.order.count()).toBe(0);
  });

  it("requires sign-in", async () => {
    const { address, cheap } = await shopFixture();
    const res = await createOrderRoute(await request("/api/orders", { body: orderBody(cheap.id, address.id) }), noParams);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/orders: pricing and batch assignment", () => {
  it("prices from the database, ignores client-sent money, joins the sea batch and issues a product invoice", async () => {
    const { customer, address, cheap, dear, seaBatch } = await shopFixture();
    const body = {
      ...orderBody(cheap.id, address.id),
      items: [
        { variantId: cheap.id, quantity: 2, unitPrice: "1.00" },
        { variantId: dear.id, quantity: 3 },
      ],
      productTotal: "5.00",
    };
    const res = (await createOrderRoute(
      await request("/api/orders", { body, user: customer, cookie: `${CART_COOKIE}=abc` }),
      noParams,
    )) as NextResponse;
    expect(res.status).toBe(201);
    const { order } = await res.json();

    // 2 × 18500.00 + 3 × 19999.99 = 96999.97
    expect(order.productTotal).toBe("96999.97");
    expect(order.shippingTotal).toBe("0.00");
    expect(order.grandTotal).toBe("96999.97");
    expect(order.orderNumber).toMatch(/^FZ-\d{4,}$/);
    expect(order.batch.id).toBe(seaBatch.id);
    expect(order.status).toBe("preorder_placed");
    expect(order.items.map((i: { unitPrice: string }) => i.unitPrice).sort()).toEqual(["18500.00", "19999.99"]);

    const invoices = await db.invoice.findMany({ where: { orderId: order.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ kind: "product", version: 1, status: "issued" });
    expect(invoices[0]!.amount.toFixed(2)).toBe("96999.97");
    expect(invoices[0]!.dueAt).not.toBeNull();

    expect(res.cookies.get(CART_COOKIE)?.value).toBe("");
  });

  it("snapshots the unit price so later price changes don't touch the order", async () => {
    const { customer, address, cheap } = await shopFixture();
    const res = await createOrderRoute(await request("/api/orders", { body: orderBody(cheap.id, address.id), user: customer }), noParams);
    const { order } = await res.json();

    await db.productVariant.update({ where: { id: cheap.id }, data: { buyingPrice: new Prisma.Decimal("25000.00") } });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.unitPrice.toFixed(2)).toBe("18500.00");
    expect(item.lineTotal.toFixed(2)).toBe("37000.00");
  });

  it("merges duplicate lines for the same option", async () => {
    const { customer, address, cheap } = await shopFixture();
    const body = { ...orderBody(cheap.id, address.id), items: [{ variantId: cheap.id, quantity: 2 }, { variantId: cheap.id, quantity: 1 }] };
    const { order } = await (await createOrderRoute(await request("/api/orders", { body, user: customer }), noParams)).json();
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(3);
  });

  it("returns 409 when no batch is open for the chosen method", async () => {
    const { customer, address, cheap } = await shopFixture();
    const res = await createOrderRoute(
      await request("/api/orders", { body: orderBody(cheap.id, address.id, { shipMethod: "air" }), user: customer }),
      noParams,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_open_batch");
  });

  it("joins the soonest-closing open batch for the method, skipping closed or expired ones", async () => {
    const { customer, address, cheap } = await shopFixture();
    await createBatch("air", { cutoffInDays: 2, status: "ordered", name: "closed air" });
    await createBatch("air", { cutoffInDays: -1, name: "expired air" });
    await createBatch("air", { cutoffInDays: 20, name: "later air" });
    const soon = await createBatch("air", { cutoffInDays: 5, name: "soon air" });

    const res = await createOrderRoute(
      await request("/api/orders", { body: orderBody(cheap.id, address.id, { shipMethod: "air" }), user: customer }),
      noParams,
    );
    const { order } = await res.json();
    expect(order.batch.id).toBe(soon.id);
    expect(order.shipMethod).toBe("air");
  });

  it("rejects another user's address and unavailable options", async () => {
    const { customer, cheap } = await shopFixture();
    const stranger = await createUser();
    const strangersAddress = await createAddress(stranger);
    const ownAddress = await createAddress(customer);

    const wrongAddress = await createOrderRoute(
      await request("/api/orders", { body: orderBody(cheap.id, strangersAddress.id), user: customer }),
      noParams,
    );
    expect((await wrongAddress.json()).error.code).toBe("invalid_address");

    await db.productVariant.update({ where: { id: cheap.id }, data: { isActive: false } });
    const inactive = await createOrderRoute(await request("/api/orders", { body: orderBody(cheap.id, ownAddress.id), user: customer }), noParams);
    expect((await inactive.json()).error.code).toBe("item_unavailable");
  });

  it("limits customers to 20 per item but lets dropshippers order in bulk", async () => {
    const { customer, address, cheap } = await shopFixture();
    const tooMany = { ...orderBody(cheap.id, address.id), items: [{ variantId: cheap.id, quantity: 21 }] };
    const res = await createOrderRoute(await request("/api/orders", { body: tooMany, user: customer }), noParams);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("quantity_limit");

    const dropshipper = await createUser("dropshipper");
    const dsAddress = await createAddress(dropshipper);
    const bulk = { ...orderBody(cheap.id, dsAddress.id), items: [{ variantId: cheap.id, quantity: 150 }] };
    const ok = await createOrderRoute(await request("/api/orders", { body: bulk, user: dropshipper }), noParams);
    expect(ok.status).toBe(201);
    expect((await ok.json()).order.productTotal).toBe("2775000.00");
  });
});

describe("reading orders", () => {
  it("lists only the customer's own orders; staff see all; other people's orders are 404", async () => {
    const { customer, address, cheap } = await shopFixture();
    const other = await createUser();
    const otherAddress = await createAddress(other);
    await createOrderRoute(await request("/api/orders", { body: orderBody(cheap.id, address.id), user: customer }), noParams);
    const { order: othersOrder } = await (
      await createOrderRoute(await request("/api/orders", { body: orderBody(cheap.id, otherAddress.id), user: other }), noParams)
    ).json();

    const mine = await (await listOrdersRoute(await request("/api/orders", { user: customer }), noParams)).json();
    expect(mine.total).toBe(1);

    const support = await createUser("support");
    const all = await (await listOrdersRoute(await request("/api/orders", { user: support }), noParams)).json();
    expect(all.total).toBe(2);

    const peek = await getOrderRoute(await request(`/api/orders/${othersOrder.id}`, { user: customer }), { params: { id: othersOrder.id } });
    expect(peek.status).toBe(404);
    const own = await getOrderRoute(await request(`/api/orders/${othersOrder.id}`, { user: other }), { params: { id: othersOrder.id } });
    expect(own.status).toBe(200);
  });
});

describe("POST /api/orders/:id/cancel", () => {
  async function placed() {
    const shop = await shopFixture();
    const res = await createOrderRoute(await request("/api/orders", { body: orderBody(shop.cheap.id, shop.address.id), user: shop.customer }), noParams);
    return { ...shop, order: (await res.json()).order as { id: string } };
  }

  it("cancels an unpaid preorder and voids its product invoice", async () => {
    const { customer, order } = await placed();
    const res = await cancelRoute(await request(`/api/orders/${order.id}/cancel`, { method: "POST", user: customer }), { params: { id: order.id } });
    expect(res.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("cancelled");
    expect((await db.invoice.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("voided");
  });

  it("refuses once the product price is paid, or the batch has moved on, or for someone else", async () => {
    const { customer, order } = await placed();
    const stranger = await createUser();
    const strangerRes = await cancelRoute(await request(`/x`, { method: "POST", user: stranger }), { params: { id: order.id } });
    expect(strangerRes.status).toBe(404);

    await db.invoice.updateMany({ where: { orderId: order.id }, data: { status: "paid", paidAt: new Date() } });
    const paid = await cancelRoute(await request(`/x`, { method: "POST", user: customer }), { params: { id: order.id } });
    expect((await paid.json()).error.code).toBe("order_paid");

    await db.order.update({ where: { id: order.id }, data: { status: "batch_confirmed" } });
    const confirmed = await cancelRoute(await request(`/x`, { method: "POST", user: customer }), { params: { id: order.id } });
    expect((await confirmed.json()).error.code).toBe("not_cancellable");
  });
});
