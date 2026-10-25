import { Prisma, type User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createBatchRoute } from "@/app/api/admin/batches/route";
import { PATCH as patchBatchRoute } from "@/app/api/admin/batches/[id]/route";
import { POST as measurementsRoute } from "@/app/api/admin/batches/[id]/measurements/route";
import { placeOrder } from "@/server/orders/place-order";
import { db, resetDatabase } from "./db";
import { batchWithOrders, createAddress, createUser, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const patch = async (batchId: string, body: object, user: Pick<User, "id" | "role">) =>
  patchBatchRoute(await request(`/api/admin/batches/${batchId}`, { method: "PATCH", body, user }), { params: { id: batchId } });

async function measureAll(batchId: string, user: Pick<User, "id" | "role">) {
  const items = await db.orderItem.findMany({ where: { order: { batchId, status: { not: "cancelled" } } } });
  const rows = items.map((item, i) => ({ orderItemId: item.id, weightG: 400 + i * 10 }));
  return measurementsRoute(await request(`/api/admin/batches/${batchId}/measurements`, { body: { rows }, user }), { params: { id: batchId } });
}

describe("POST /api/admin/batches", () => {
  it("lets ops open a batch and audits it", async () => {
    const ops = await createUser("ops");
    const cutoffAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await createBatchRoute(await request("/api/admin/batches", { body: { name: "December Air", cutoffAt, defaultShipMethod: "air" }, user: ops }), { params: {} });
    expect(res.status).toBe(201);
    const { batch } = await res.json();
    expect(batch.status).toBe("collecting");
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: batch.id } });
    expect(audit).toMatchObject({ action: "batch.created", actorId: ops.id });
  });

  it("refuses a cutoff in the past and staff without batches.manage", async () => {
    const ops = await createUser("ops");
    const past = await createBatchRoute(
      await request("/api/admin/batches", { body: { name: "Old", cutoffAt: new Date(Date.now() - 1000).toISOString(), defaultShipMethod: "sea" }, user: ops }),
      { params: {} },
    );
    expect(past.status).toBe(422);

    for (const role of ["support", "finance"] as const) {
      const res = await createBatchRoute(
        await request("/api/admin/batches", { body: { name: "Nope", cutoffAt: new Date(Date.now() + 86_400_000).toISOString(), defaultShipMethod: "sea" }, user: await createUser(role) }),
        { params: {} },
      );
      expect(res.status).toBe(403);
    }
    expect(await db.batch.count()).toBe(0);
  });
});

describe("collecting → ordered", () => {
  it("confirms paid orders, cancels unpaid ones, notifies only confirmed customers and audits everything", async () => {
    const { batch, orders } = await batchWithOrders({ paid: 3, unpaid: 2 });
    const ops = await createUser("ops", "Tunde");

    const res = await patch(batch.id, { status: "ordered" }, ops);
    expect(res.status).toBe(200);
    const { summary } = await res.json();
    expect(summary.confirmed).toHaveLength(3);
    expect(summary.cancelled).toHaveLength(2);

    for (const order of orders) {
      const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { invoices: true } });
      expect(fresh.status).toBe(order.paid ? "batch_confirmed" : "cancelled");
      expect(fresh.invoices[0]!.status).toBe(order.paid ? "paid" : "voided");
    }

    const notified = await db.notification.findMany({ where: { template: "batch_closed" } });
    expect(new Set(notified.map((n) => n.userId))).toEqual(new Set(orders.filter((o) => o.paid).map((o) => o.customer.id)));
    expect(notified.map((n) => n.channel).sort()).toEqual(["in_app", "in_app", "in_app", "whatsapp", "whatsapp", "whatsapp"]);

    const batchAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: batch.id, action: "batch.status_changed" } });
    expect(batchAudit.before).toEqual({ status: "collecting" });
    expect(batchAudit.after).toMatchObject({ status: "ordered", confirmed: summary.confirmed, cancelled: summary.cancelled });
    expect(await db.auditLog.count({ where: { action: "order.cancelled_unpaid" } })).toBe(2);
  });

  it("stops new orders joining once the batch is ordered", async () => {
    const { batch, product } = await batchWithOrders({ paid: 1, unpaid: 0 });
    await patch(batch.id, { status: "ordered" }, await createUser("ops"));

    const late = await createUser();
    const address = await createAddress(late);
    await expect(
      placeOrder(late, { items: [{ variantId: product.variants[0]!.id, quantity: 1 }], shipMethod: "sea", addressId: address.id, acknowledgedShippingLater: true }),
    ).rejects.toMatchObject({ code: "no_open_batch" });
  });

  it("only allows forward manual transitions", async () => {
    const { batch } = await batchWithOrders({ paid: 1, unpaid: 0 });
    const ops = await createUser("ops");
    for (const status of ["measured", "invoiced", "shipped", "delivered"]) {
      const res = await patch(batch.id, { status }, ops);
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("invalid_transition");
    }
    await patch(batch.id, { status: "ordered" }, ops);
    expect((await patch(batch.id, { status: "collecting" }, ops)).status).toBe(409);
    expect((await patch(batch.id, { status: "invoiced" }, ops)).status).toBe(409);
  });

  it("cancels a batch only when nobody has paid", async () => {
    const ops = await createUser("ops");
    const withPaid = await batchWithOrders({ paid: 1, unpaid: 1 });
    const blocked = await patch(withPaid.batch.id, { status: "cancelled" }, ops);
    expect((await blocked.json()).error.code).toBe("batch_has_paid_orders");

    await resetDatabase();
    const unpaidOnly = await batchWithOrders({ paid: 0, unpaid: 2 });
    const opsAgain = await createUser("ops");
    expect((await patch(unpaidOnly.batch.id, { status: "cancelled" }, opsAgain)).status).toBe(200);
    expect(await db.order.count({ where: { status: "cancelled" } })).toBe(2);
  });

  it("forbids support and customers", async () => {
    const { batch } = await batchWithOrders({ paid: 1, unpaid: 0 });
    expect((await patch(batch.id, { status: "ordered" }, await createUser("support"))).status).toBe(403);
    expect((await patch(batch.id, { status: "ordered" }, await createUser("customer"))).status).toBe(403);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("collecting");
  });
});

describe("ordered → measured", () => {
  it("is blocked until every live item is measured, then moves orders to measured", async () => {
    const { batch } = await batchWithOrders({ paid: 2, unpaid: 1 });
    const ops = await createUser("ops");
    await patch(batch.id, { status: "ordered" }, ops);

    const early = await patch(batch.id, { status: "measured" }, ops);
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "measurements_missing", details: { unmeasured: 4 } } });

    expect((await measureAll(batch.id, ops)).status).toBe(200);
    expect((await patch(batch.id, { status: "measured" }, ops)).status).toBe(200);

    const statuses = await db.order.groupBy({ by: ["status"], where: { batchId: batch.id }, _count: { _all: true } });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count._all]))).toEqual({ measured: 2, cancelled: 1 });
  });
});

describe("shipping quote", () => {
  it("is accepted once ordered, as a 2 dp string, and audited", async () => {
    const { batch } = await batchWithOrders({ paid: 1, unpaid: 0 });
    const ops = await createUser("ops");

    const tooEarly = await patch(batch.id, { shippingQuote: "500000.00" }, ops);
    expect((await tooEarly.json()).error.code).toBe("quote_not_allowed");

    await patch(batch.id, { status: "ordered" }, ops);
    for (const bad of ["0", "0.00", "-5", "12.345", "abc", "1e6"]) {
      expect((await patch(batch.id, { shippingQuote: bad }, ops)).status).toBe(422);
    }

    const ok = await patch(batch.id, { shippingQuote: "500000.5", allocationMethod: "volumetric" }, ops);
    expect((await ok.json()).batch).toMatchObject({ shippingQuote: "500000.50", allocationMethod: "volumetric" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: batch.id, action: "batch.quote_updated" } });
    expect(audit.before).toEqual({ shippingQuote: null, allocationMethod: null });
    expect(audit.after).toEqual({ shippingQuote: "500000.50", allocationMethod: "volumetric" });
  });

  it("is locked after the allocation is approved", async () => {
    const { batch, orders } = await batchWithOrders({ paid: 1, unpaid: 0 });
    const ops = await createUser("ops");
    await patch(batch.id, { status: "ordered" }, ops);
    await db.shippingAllocation.create({
      data: {
        batchId: batch.id, orderId: orders[0]!.id, method: "weight", shippingQuote: new Prisma.Decimal("1000.00"),
        totalBatchWeightG: 1, orderWeightG: 1, allocatedAmount: new Prisma.Decimal("1000.00"), calculatedAt: new Date(), approvedAt: new Date(),
      },
    });
    const res = await patch(batch.id, { shippingQuote: "2000.00" }, ops);
    expect((await res.json()).error.code).toBe("allocation_approved");
  });
});
