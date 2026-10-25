import { Prisma, type User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveRoute } from "@/app/api/admin/batches/[id]/allocation/approve/route";
import { GET as previewRoute } from "@/app/api/admin/batches/[id]/allocation/preview/route";
import { PATCH as patchBatchRoute } from "@/app/api/admin/batches/[id]/route";
import { POST as measurementsRoute } from "@/app/api/admin/batches/[id]/measurements/route";
import { db, resetDatabase } from "./db";
import { batchWithOrders, createUser, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

type Actor = Pick<User, "id" | "role">;

const patch = async (batchId: string, body: object, user: Actor) =>
  patchBatchRoute(await request(`/x`, { method: "PATCH", body, user }), { params: { id: batchId } });
const preview = async (batchId: string, user: Actor) => previewRoute(await request(`/x`, { user }), { params: { id: batchId } });
const approve = async (batchId: string, fingerprint: string, user: Actor) =>
  approveRoute(await request(`/x`, { body: { fingerprint }, user }), { params: { id: batchId } });

/** Three paid orders, closed, measured (orders weigh 1.4 kg, 2.8 kg, 4.2 kg), quote ₦100,000.00 by weight. */
async function readyBatch(opts: { quote?: string; method?: string; markMeasured?: boolean } = {}) {
  const setup = await batchWithOrders({ paid: 3, unpaid: 0 });
  const ops = await createUser("ops", "Tunde");
  await patch(setup.batch.id, { status: "ordered" }, ops);

  const rows = [];
  for (const [index, order] of setup.orders.entries()) {
    const items = await db.orderItem.findMany({ where: { orderId: order.id }, orderBy: { quantity: "desc" } });
    // 2 × cheap + 1 × dear per order; per-unit weights scale with the order index.
    rows.push({ orderItemId: items[0]!.id, weightG: 350 * (index + 1), lengthMm: 300, widthMm: 200, heightMm: 100 });
    rows.push({ orderItemId: items[1]!.id, weightG: 700 * (index + 1), lengthMm: 100, widthMm: 100, heightMm: 100 });
  }
  await measurementsRoute(await request(`/x`, { body: { rows }, user: ops }), { params: { id: setup.batch.id } });
  if (opts.markMeasured !== false) await patch(setup.batch.id, { status: "measured" }, ops);
  if (opts.quote !== undefined) await patch(setup.batch.id, { shippingQuote: opts.quote, allocationMethod: opts.method ?? "weight" }, ops);
  return { ...setup, ops };
}

describe("allocation preview", () => {
  it("computes the split without persisting anything", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const res = await preview(batch.id, ops);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Weights 1400 g, 2800 g, 4200 g of 8400 g → 1/6, 2/6, 3/6 of ₦100,000.00
    expect(body.orders.map((o: { shippingShare: string }) => o.shippingShare)).toEqual(["16666.67", "33333.33", "50000.00"]);
    expect(body.allocatedTotal).toBe("100000.00");
    expect(body.orders[0].grandTotal).toBe(new Prisma.Decimal(body.orders[0].productTotal).add("16666.67").toFixed(2));
    expect(body.fingerprint).toMatch(/^[0-9a-f]{32}$/);

    expect(await db.shippingAllocation.count()).toBe(0);
    expect(await db.invoice.count({ where: { kind: "shipping" } })).toBe(0);
    expect(await db.order.count({ where: { status: "invoiced" } })).toBe(0);
  });

  it("explains why it can't split yet: missing quote, missing measurements", async () => {
    const { batch, ops } = await readyBatch();
    const noQuote = await preview(batch.id, ops);
    expect(noQuote.status).toBe(422);
    expect((await noQuote.json()).error.code).toBe("method_missing");

    await patch(batch.id, { allocationMethod: "weight" }, ops);
    expect((await (await preview(batch.id, ops)).json()).error.code).toBe("quote_missing");

    await resetDatabase();
    const unmeasured = await batchWithOrders({ paid: 2, unpaid: 0 });
    const ops2 = await createUser("ops");
    await patch(unmeasured.batch.id, { status: "ordered" }, ops2);
    await patch(unmeasured.batch.id, { shippingQuote: "5000.00", allocationMethod: "weight" }, ops2);
    const missing = await (await preview(unmeasured.batch.id, ops2)).json();
    expect(missing.error).toMatchObject({ code: "measurements_missing", message: "4 items are not measured yet." });
  });

  it("reads the volumetric divisor from settings", async () => {
    const { batch, ops } = await readyBatch({ quote: "60000.00", method: "volumetric" });
    const before = await (await preview(batch.id, ops)).json();
    expect(before.volumetricDivisor).toBe(5000);

    await db.setting.updateMany({ data: { volumetricDivisor: 1000 } });
    const after = await (await preview(batch.id, ops)).json();
    expect(after.volumetricDivisor).toBe(1000);
    expect(after.totalChargeableWeightG).toBeGreaterThan(before.totalChargeableWeightG);
    expect(after.allocatedTotal).toBe("60000.00");
  });
});

describe("allocation approval", () => {
  it("persists exactly the previewed totals and issues one shipping invoice per order", async () => {
    const { batch, ops, orders } = await readyBatch({ quote: "100000.00" });
    const shown = await (await preview(batch.id, ops)).json();

    const res = await approve(batch.id, shown.fingerprint, ops);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ approved: true, invoices: 3 });

    const allocations = await db.shippingAllocation.findMany({ where: { batchId: batch.id }, include: { order: true } });
    expect(allocations).toHaveLength(3);
    for (const row of shown.orders as Array<{ orderId: string; shippingShare: string; chargeableWeightG: number }>) {
      const persisted = allocations.find((a) => a.orderId === row.orderId)!;
      expect(persisted.allocatedAmount.toFixed(2)).toBe(row.shippingShare);
      expect(persisted.orderWeightG).toBe(row.chargeableWeightG);
      expect(persisted).toMatchObject({ method: "weight", totalBatchWeightG: 8400, approvedById: ops.id });
      expect(persisted.approvedAt).not.toBeNull();
      expect(persisted.shippingQuote.toFixed(2)).toBe("100000.00");

      const invoice = await db.invoice.findFirstOrThrow({ where: { orderId: row.orderId, kind: "shipping" } });
      expect(invoice).toMatchObject({ version: 1, status: "issued", currency: "NGN" });
      expect(invoice.amount.toFixed(2)).toBe(row.shippingShare);
      expect(invoice.dueAt!.getTime() - invoice.issuedAt.getTime()).toBe(7 * 86_400_000);
      expect(invoice.breakdown).toMatchObject({
        kind: "shipping",
        method: "weight",
        batchQuote: "100000.00",
        totalBatchWeightG: 8400,
        order: { chargeableWeightG: row.chargeableWeightG },
        formula: `100000.00 × ${row.chargeableWeightG} g ÷ 8400 g`,
        amount: row.shippingShare,
      });

      const order = await db.order.findUniqueOrThrow({ where: { id: row.orderId } });
      expect(order.status).toBe("invoiced");
      expect(order.shippingTotal.toFixed(2)).toBe(row.shippingShare);
      expect(order.grandTotal.toFixed(2)).toBe(order.productTotal.add(row.shippingShare).toFixed(2));
    }

    const persistedTotal = allocations.reduce((s, a) => s.add(a.allocatedAmount), new Prisma.Decimal(0));
    expect(persistedTotal.toFixed(2)).toBe("100000.00");
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("invoiced");

    const notices = await db.notification.findMany({ where: { template: "shipping_invoice_ready" } });
    expect(new Set(notices.map((n) => n.userId))).toEqual(new Set(orders.map((o) => o.customer.id)));
    expect(notices.map((n) => n.channel).filter((c) => c === "whatsapp")).toHaveLength(3);
    expect(notices.find((n) => n.channel === "email")!.payload).toMatchObject({ invoiceUrl: expect.stringMatching(/\/invoices\/[0-9a-f-]{36}$/) });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "allocation.approved", entityId: batch.id } });
    expect(audit.after).toMatchObject({ quote: "100000.00", method: "weight", fingerprint: shown.fingerprint, orders: 3 });
  });

  it("is idempotent: a second approval is 409 and creates no duplicate invoices", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const { fingerprint } = await (await preview(batch.id, ops)).json();
    expect((await approve(batch.id, fingerprint, ops)).status).toBe(200);

    const again = await approve(batch.id, fingerprint, ops);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("already_approved");
    expect(await db.invoice.count({ where: { kind: "shipping" } })).toBe(3);
    expect(await db.shippingAllocation.count()).toBe(3);
    expect(await db.notification.count({ where: { template: "shipping_invoice_ready" } })).toBe(9);
  });

  it("lets only one of several simultaneous approvals through", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const admin = await createUser("admin");
    const { fingerprint } = await (await preview(batch.id, ops)).json();

    const results = await Promise.all([approve(batch.id, fingerprint, ops), approve(batch.id, fingerprint, admin), approve(batch.id, fingerprint, ops)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await db.invoice.count({ where: { kind: "shipping" } })).toBe(3);
  });

  it("refuses a stale preview when measurements changed after it was shown", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const { fingerprint } = await (await preview(batch.id, ops)).json();

    const item = await db.orderItem.findFirstOrThrow({ where: { order: { batchId: batch.id } }, include: { measurement: true } });
    await measurementsRoute(await request(`/x`, { body: { rows: [{ orderItemId: item.id, weightG: item.measurement!.weightG + 100 }] }, user: ops }), {
      params: { id: batch.id },
    });

    const res = await approve(batch.id, fingerprint, ops);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("preview_stale");
    expect(await db.shippingAllocation.count()).toBe(0);

    const fresh = await (await preview(batch.id, ops)).json();
    expect((await approve(batch.id, fresh.fingerprint, ops)).status).toBe(200);
  });

  it("requires the batch to be marked measured, and a quote above zero", async () => {
    const { batch, ops } = await readyBatch({ markMeasured: false });
    await patch(batch.id, { shippingQuote: "100.00", allocationMethod: "equal" }, ops);
    const { fingerprint } = await (await preview(batch.id, ops)).json();
    const notMeasured = await approve(batch.id, fingerprint, ops);
    expect((await notMeasured.json()).error.code).toBe("batch_not_measured");

    // A zero quote never reaches the database: the PATCH refuses it.
    expect((await patch(batch.id, { shippingQuote: "0.00" }, ops)).status).toBe(422);
  });

  it("is limited to admin and ops", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const { fingerprint } = await (await preview(batch.id, ops)).json();
    for (const role of ["finance", "support", "customer"] as const) {
      expect((await approve(batch.id, fingerprint, await createUser(role))).status).toBe(403);
    }
    expect(await db.shippingAllocation.count()).toBe(0);
    // Support can still look.
    expect((await preview(batch.id, await createUser("support"))).status).toBe(200);
  });

  it("locks measurements and the quote once approved", async () => {
    const { batch, ops } = await readyBatch({ quote: "100000.00" });
    const { fingerprint } = await (await preview(batch.id, ops)).json();
    await approve(batch.id, fingerprint, ops);

    const item = await db.orderItem.findFirstOrThrow({ where: { order: { batchId: batch.id } } });
    const remeasure = await measurementsRoute(await request(`/x`, { body: { rows: [{ orderItemId: item.id, weightG: 1 }] }, user: ops }), {
      params: { id: batch.id },
    });
    expect(remeasure.status).toBe(409);
    expect((await patch(batch.id, { shippingQuote: "1.00" }, ops)).status).toBe(409);
  });
});
