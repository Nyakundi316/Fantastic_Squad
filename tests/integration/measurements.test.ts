import { Prisma, type User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchBatchRoute } from "@/app/api/admin/batches/[id]/route";
import { POST as measurementsRoute } from "@/app/api/admin/batches/[id]/measurements/route";
import { db, resetDatabase } from "./db";
import { batchWithOrders, createUser, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

type Staff = Pick<User, "id" | "role">;

async function orderedBatch() {
  const setup = await batchWithOrders({ paid: 2, unpaid: 1 });
  const ops = await createUser("ops", "Tunde");
  await patchBatchRoute(await request(`/x`, { method: "PATCH", body: { status: "ordered" }, user: ops }), { params: { id: setup.batch.id } });
  const items = await db.orderItem.findMany({
    where: { order: { batchId: setup.batch.id, status: { not: "cancelled" } } },
    orderBy: { id: "asc" },
  });
  const cancelledItem = await db.orderItem.findFirstOrThrow({ where: { order: { batchId: setup.batch.id, status: "cancelled" } } });
  return { ...setup, ops, items, cancelledItem };
}

const upsert = async (batchId: string, rows: object[], user: Staff) =>
  measurementsRoute(await request(`/api/admin/batches/${batchId}/measurements`, { body: { rows }, user }), { params: { id: batchId } });

describe("bulk measurement upsert", () => {
  it("creates measurements and writes one audit entry per row", async () => {
    const { batch, items, ops } = await orderedBatch();
    const rows = items.map((item, i) => ({ orderItemId: item.id, weightG: 500 + i, lengthMm: 300, widthMm: 200, heightMm: 100 }));

    const res = await upsert(batch.id, rows, ops);
    expect(await res.json()).toEqual({ created: 4, updated: 0, unchanged: 0 });

    const audits = await db.auditLog.findMany({ where: { action: "measurement.created" } });
    expect(audits).toHaveLength(4);
    expect(audits[0]).toMatchObject({ actorId: ops.id, entityType: "measurement", before: null });
    expect(audits[0]!.after).toMatchObject({ batchId: batch.id, weightG: expect.any(Number), lengthMm: 300 });
    const measurement = await db.measurement.findFirstOrThrow({ where: { orderItemId: items[0]!.id } });
    expect(measurement.measuredById).toBe(ops.id);
  });

  it("logs every change with before and after, and skips unchanged rows", async () => {
    const { batch, items, ops } = await orderedBatch();
    const first = items.map((item) => ({ orderItemId: item.id, weightG: 450 }));
    await upsert(batch.id, first, ops);

    const admin = await createUser("admin", "Funmi");
    const second = [
      { orderItemId: items[0]!.id, weightG: 470 },
      { orderItemId: items[1]!.id, weightG: 450, lengthMm: 120, widthMm: 80, heightMm: 40 },
      { orderItemId: items[2]!.id, weightG: 450 },
    ];
    expect(await (await upsert(batch.id, second, admin)).json()).toEqual({ created: 0, updated: 2, unchanged: 1 });

    const updates = await db.auditLog.findMany({ where: { action: "measurement.updated" }, orderBy: { createdAt: "asc" } });
    expect(updates).toHaveLength(2);
    const weightChange = updates.find((u) => (u.after as { weightG: number }).weightG === 470)!;
    expect(weightChange.actorId).toBe(admin.id);
    expect(weightChange.before).toMatchObject({ weightG: 450, lengthMm: null });
    expect(weightChange.after).toMatchObject({ weightG: 470 });

    // Every create and update is in the log: 4 + 2.
    expect(await db.auditLog.count({ where: { entityType: "measurement" } })).toBe(6);
  });

  it.each([
    ["zero weight", { weightG: 0 }],
    ["fractional grams", { weightG: 12.5 }],
    ["negative dimension", { weightG: 100, lengthMm: -1, widthMm: 1, heightMm: 1 }],
    ["only two dimensions", { weightG: 100, lengthMm: 10, widthMm: 10 }],
    ["weight as a string", { weightG: "100" }],
  ])("rejects %s", async (_label, values) => {
    const { batch, items, ops } = await orderedBatch();
    const res = await upsert(batch.id, [{ orderItemId: items[0]!.id, ...values }], ops);
    expect(res.status).toBe(422);
    expect(await db.measurement.count()).toBe(0);
  });

  it("is all-or-nothing when any row is for an item outside the batch", async () => {
    const { batch, items, ops, cancelledItem } = await orderedBatch();
    const rows = [
      { orderItemId: items[0]!.id, weightG: 300 },
      { orderItemId: cancelledItem.id, weightG: 300 },
    ];
    const res = await upsert(batch.id, rows, ops);
    expect((await res.json()).error.code).toBe("unknown_items");
    expect(await db.measurement.count()).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "measurement" } })).toBe(0);

    const dupes = await upsert(batch.id, [{ orderItemId: items[0]!.id, weightG: 1 }, { orderItemId: items[0]!.id, weightG: 2 }], ops);
    expect((await dupes.json()).error.code).toBe("duplicate_rows");
  });

  it("only accepts measurements while the batch is ordered or measured and unapproved", async () => {
    const collecting = await batchWithOrders({ paid: 1, unpaid: 0 });
    const ops = await createUser("ops");
    const item = await db.orderItem.findFirstOrThrow({ where: { order: { batchId: collecting.batch.id } } });
    expect((await (await upsert(collecting.batch.id, [{ orderItemId: item.id, weightG: 100 }], ops)).json()).error.code).toBe("not_measurable");

    await resetDatabase();
    const { batch, items, ops: ops2, orders } = await orderedBatch();
    await db.shippingAllocation.create({
      data: {
        batchId: batch.id, orderId: orders[0]!.id, method: "weight", shippingQuote: new Prisma.Decimal("1000.00"),
        totalBatchWeightG: 1, orderWeightG: 1, allocatedAmount: new Prisma.Decimal("1000.00"), calculatedAt: new Date(), approvedAt: new Date(),
      },
    });
    expect((await (await upsert(batch.id, [{ orderItemId: items[0]!.id, weightG: 100 }], ops2)).json()).error.code).toBe("allocation_approved");
  });

  it.each(["support", "finance"] as const)("forbids %s", async (role) => {
    const { batch, items } = await orderedBatch();
    const res = await upsert(batch.id, [{ orderItemId: items[0]!.id, weightG: 100 }], await createUser(role));
    expect(res.status).toBe(403);
  });
});
