import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as settingsRoute } from "@/app/api/admin/settings/route";
import { POST as roleRoute } from "@/app/api/admin/users/role/route";
import { GET as cronRoute } from "@/app/api/cron/notifications/route";
import { POST as markReadRoute } from "@/app/api/notifications/read/route";
import { GET as bellRoute } from "@/app/api/notifications/route";
import { transitionBatch, updateBatchSettings } from "@/server/batches/transitions";
import { upsertMeasurements } from "@/server/batches/measurements";
import { approveAllocation, previewAllocation } from "@/server/allocation/batch-allocation";
import { dispatchPending, enqueueDueReminders } from "@/server/notifications/dispatch";
import { TEMPLATE_KEYS } from "@/server/notifications/templates";
import { lockInvoice, settleInvoice } from "@/server/payments/settle";
import { createShipment, updateShipment } from "@/server/shipments";
import { Prisma } from "@prisma/client";
import { db, resetDatabase } from "./db";
import { batchWithOrders, createUser, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function pay(invoiceId: string) {
  await db.$transaction(async (tx) => settleInvoice(tx, await lockInvoice(tx, invoiceId), { method: "bank_transfer" }));
}

/** Drives one batch from preorder to delivery through the real services. */
async function fullLifecycle() {
  const { batch, orders } = await batchWithOrders({ paid: 0, unpaid: 2 });
  for (const [i, order] of orders.entries()) await db.user.update({ where: { id: order.customer.id }, data: { email: `customer${i}@example.com` } });
  const ops = await createUser("ops");

  for (const order of orders) {
    const productInvoice = await db.invoice.findFirstOrThrow({ where: { orderId: order.id, kind: "product" } });
    await pay(productInvoice.id); // order_received
  }
  await transitionBatch(batch.id, "ordered", ops); // batch_closed
  const items = await db.orderItem.findMany({ where: { order: { batchId: batch.id } } });
  await upsertMeasurements(batch.id, items.map((item) => ({ orderItemId: item.id, weightG: 800 })), ops);
  await transitionBatch(batch.id, "measured", ops);
  await updateBatchSettings(batch.id, { shippingQuote: new Prisma.Decimal("20000.00"), allocationMethod: "weight" }, ops);
  await approveAllocation(batch.id, ops, (await previewAllocation(batch.id)).fingerprint!); // shipping_invoice_ready

  const shippingInvoices = await db.invoice.findMany({ where: { kind: "shipping", order: { batchId: batch.id } }, orderBy: { orderId: "asc" } });
  await enqueueDueReminders(new Date(shippingInvoices[0]!.dueAt!.getTime() - 2 * 86_400_000)); // shipping_invoice_reminder
  await pay(shippingInvoices[0]!.id); // shipping_paid

  const shipment = await createShipment(batch.id, { carrier: "Maersk", trackingNumber: "MSKU1", estimatedDays: 35 }, ops);
  await updateShipment(shipment.id, { status: "in_transit" }, ops); // shipment_dispatched
  await updateShipment(shipment.id, { status: "arrived" }, ops);
  await updateShipment(shipment.id, { status: "delivered" }, ops); // shipment_delivered
  return { batch, orders, shippingInvoices };
}

describe("notification templates", () => {
  it("fires all 7 templates across a batch's life and logs every send in notifications", async () => {
    await fullLifecycle();
    const result = await dispatchPending({ budgetMs: 60_000, limit: 1000 });
    expect(result.failed).toBe(0);

    const rows = await db.notification.findMany();
    const fired = new Set(rows.map((r) => r.template));
    expect([...fired].sort()).toEqual([...TEMPLATE_KEYS].sort());

    for (const row of rows) {
      if (row.channel === "in_app") {
        expect(row.status).toBe("queued"); // waiting for the bell
      } else {
        expect(row.status, `${row.template} via ${row.channel}`).toBe("sent");
        expect(row.sentAt).not.toBeNull();
      }
    }
    // Email copies only for the templates that have an email channel.
    const emailed = new Set(rows.filter((r) => r.channel === "email").map((r) => r.template));
    expect([...emailed].sort()).toEqual(["order_received", "shipment_dispatched", "shipping_invoice_ready"]);
  });

  it("renders admin-edited wording, and never sends the same row twice", async () => {
    await batchWithOrders({ paid: 0, unpaid: 1 });
    const invoice = await db.invoice.findFirstOrThrow({ where: { kind: "product" } });
    await db.setting.create({
      data: { notificationTemplates: { order_received: { body: "Hello {{name}}, payment for {{orderNumber}} received: {{amount}}." } } },
    });
    await pay(invoice.id);

    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const [a, b] = await Promise.all([dispatchPending({ budgetMs: 10_000 }), dispatchPending({ budgetMs: 10_000 })]);
    expect(a.sent + b.sent).toBe(1); // WhatsApp only: this customer has no email
    expect(a.failed + b.failed).toBe(1);
    const whatsapp = spy.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith("[whatsapp]"));
    expect(whatsapp).toHaveLength(1);
    expect(whatsapp[0]).toMatch(/Hello Customer 1, payment for FZ-\d+ received: ₦[\d,.]+\.$/);
  });

  it("skips opted-out reminder channels but always sends essential messages", async () => {
    const { orders, shippingInvoices } = await fullLifecycle();
    const optedOut = orders.find((o) => o.id === shippingInvoices[0]!.orderId)!.customer;
    await db.user.update({ where: { id: optedOut.id }, data: { notificationPrefs: { whatsapp: false, email: true } } });

    await dispatchPending({ budgetMs: 60_000, limit: 1000 });
    const mine = await db.notification.findMany({ where: { userId: optedOut.id, channel: "whatsapp" } });
    const reminder = mine.find((n) => n.template === "shipping_invoice_reminder")!;
    expect(reminder.status).toBe("failed");
    expect(reminder.error).toMatch(/turned off whatsapp reminders/);
    expect(mine.filter((n) => n.template !== "shipping_invoice_reminder").every((n) => n.status === "sent")).toBe(true);
  });

  it("queues each due reminder once, however often the cron runs", async () => {
    const { shippingInvoices } = await fullLifecycle();
    const when = new Date(shippingInvoices[1]!.dueAt!.getTime() - 86_400_000);
    await enqueueDueReminders(when);
    await enqueueDueReminders(when);
    const reminders = await db.notification.findMany({ where: { template: "shipping_invoice_reminder", channel: "whatsapp" } });
    // One per unpaid invoice due within 3 days; the paid one is skipped.
    expect(reminders).toHaveLength(2);
  });
});

describe("cron endpoint", () => {
  it("requires the CRON_SECRET bearer token", async () => {
    const call = (auth?: string) => cronRoute(new NextRequest("http://localhost:3000/api/cron/notifications", { headers: auth ? { authorization: auth } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    const ok = await call("Bearer cron-secret-for-vitest");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ reminders: 0, sent: 0, failed: 0 });
  });
});

describe("in-app bell", () => {
  it("lists rendered notifications with links and marks them read", async () => {
    const { batchWithOrders: make } = await import("./fixtures");
    const { orders } = await make({ paid: 0, unpaid: 1 });
    await pay((await db.invoice.findFirstOrThrow({ where: { kind: "product" } })).id);
    const customer = orders[0]!.customer;

    const feed = await (await bellRoute(await request("/api/notifications", { user: customer }), { params: {} })).json();
    expect(feed.unread).toBe(1);
    expect(feed.items[0]).toMatchObject({ title: "Order confirmed", read: false, link: `/orders/${orders[0]!.id}` });
    expect(feed.items[0].body).toContain(orders[0]!.orderNumber);

    expect(await (await markReadRoute(await request("/x", { method: "POST", user: customer }), { params: {} })).json()).toEqual({ marked: 1 });
    expect((await (await bellRoute(await request("/x", { user: customer }), { params: {} })).json()).unread).toBe(0);
  });
});

describe("admin settings", () => {
  it("validates template placeholders and tone, saves edits and audits them", async () => {
    const admin = await createUser("admin");
    const patch = async (body: object, user = admin) => settingsRoute(await request("/x", { method: "PATCH", body, user }), { params: {} });

    const unknown = await patch({ notificationTemplates: { shipping_paid: { body: "Hi {{name}}, paid {{amount}} for {{orderNumber}} via {{bank}}" } } });
    expect((await unknown.json()).error.details.fields.shipping_paid[0]).toMatch(/Unknown placeholder \{\{bank\}\}/);

    const shouty = await patch({ notificationTemplates: { shipping_paid: { body: "Hi {{name}}, payment received!" } } });
    expect((await shouty.json()).error.details.fields.shipping_paid[0]).toMatch(/No exclamation marks or emoji/);

    const ok = await patch({ volumetricDivisor: 6000, notificationTemplates: { shipping_paid: { body: "Hi {{name}}, we have your {{amount}} for {{orderNumber}}." } } });
    expect(ok.status).toBe(200);
    const settings = await db.setting.findFirstOrThrow();
    expect(settings.volumetricDivisor).toBe(6000);
    expect(settings.notificationTemplates).toMatchObject({ shipping_paid: { body: "Hi {{name}}, we have your {{amount}} for {{orderNumber}}." } });
    expect(await db.auditLog.count({ where: { action: "settings.updated" } })).toBe(1);

    for (const role of ["ops", "finance", "support"] as const) {
      expect((await patch({ volumetricDivisor: 5000 }, await createUser(role))).status).toBe(403);
    }
  });

  it("lets an admin change someone else's role, never their own", async () => {
    const admin = await createUser("admin");
    const newcomer = await createUser("customer");
    const res = await roleRoute(await request("/x", { body: { phone: newcomer.phone, role: "ops" }, user: admin }), { params: {} });
    expect((await res.json()).user.role).toBe("ops");
    expect(await db.auditLog.count({ where: { action: "user.role_changed", entityId: newcomer.id } })).toBe(1);

    const self = await roleRoute(await request("/x", { body: { phone: admin.phone, role: "customer" }, user: admin }), { params: {} });
    expect((await self.json()).error.code).toBe("own_role");
  });
});
