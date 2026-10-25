import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as markPaidRoute } from "@/app/api/admin/invoices/[id]/mark-paid/route";
import { GET as exportRoute } from "@/app/api/admin/orders/export.csv/route";
import { PATCH as notesRoute } from "@/app/api/admin/orders/[id]/notes/route";
import { POST as createOrderRoute } from "@/app/api/orders/route";
import { db, resetDatabase } from "./db";
import { createUser, request, shopFixture } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function placedOrder() {
  const shop = await shopFixture();
  const res = await createOrderRoute(
    await request("/api/orders", {
      body: { items: [{ variantId: shop.cheap.id, quantity: 1 }], shipMethod: "sea", addressId: shop.address.id, acknowledgedShippingLater: true },
      user: shop.customer,
    }),
    { params: {} },
  );
  const { order } = await res.json();
  const invoice = await db.invoice.findFirstOrThrow({ where: { orderId: order.id, kind: "product" } });
  return { ...shop, orderId: order.id as string, orderNumber: order.orderNumber as string, invoice };
}

const markPaid = async (invoiceId: string, user: { id: string; role: Parameters<typeof createUser>[0] & string }, body: object = { method: "bank_transfer", reference: "TRF-889" }) =>
  markPaidRoute(await request(`/api/admin/invoices/${invoiceId}/mark-paid`, { body, user }), { params: { id: invoiceId } });

describe("manual mark-paid", () => {
  it("records the payment, marks the invoice paid, writes audit_log and queues order_received", async () => {
    const { invoice, orderNumber, customer } = await placedOrder();
    const finance = await createUser("finance", "Amaka");

    const res = await markPaid(invoice.id, finance);
    expect(res.status).toBe(200);

    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(payment).toMatchObject({ status: "success", method: "bank_transfer", kind: "product" });
    expect(payment.amount.toFixed(2)).toBe("18500.00");
    expect(payment.metadata).toMatchObject({ recordedBy: finance.id, reference: "TRF-889" });

    const updated = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.status).toBe("paid");
    expect(updated.paidAt).not.toBeNull();

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: invoice.id } });
    expect(audit).toMatchObject({ actorId: finance.id, action: "payment.marked_paid", entityType: "invoice" });
    expect(audit.after).toMatchObject({ status: "paid", orderNumber, amount: "18500.00" });

    const notes = await db.notification.findMany({ where: { userId: customer.id }, orderBy: { channel: "asc" } });
    expect(notes.map((n) => n.channel).sort()).toEqual(["email", "in_app", "whatsapp"]);
    expect(notes.every((n) => n.template === "order_received")).toBe(true);
    // Sent straight after the commit: WhatsApp goes out, email has no address on file, in-app waits for the bell.
    expect(Object.fromEntries(notes.map((n) => [n.channel, n.status]))).toEqual({ whatsapp: "sent", email: "failed", in_app: "queued" });
    expect(notes[0]!.payload).toMatchObject({ orderNumber, amount: "₦18,500.00" });
  });

  it("is safe to repeat: a second mark-paid is 409 and creates no second payment", async () => {
    const { invoice } = await placedOrder();
    const finance = await createUser("finance");
    expect((await markPaid(invoice.id, finance)).status).toBe(200);
    const again = await markPaid(invoice.id, finance);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("invoice_not_payable");
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("serialises concurrent mark-paid calls on the same invoice", async () => {
    const { invoice } = await placedOrder();
    const finance = await createUser("finance");
    const results = await Promise.all([markPaid(invoice.id, finance), markPaid(invoice.id, finance), markPaid(invoice.id, finance)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it.each(["support", "ops", "customer", "dropshipper"] as const)("forbids %s", async (role) => {
    const { invoice } = await placedOrder();
    const res = await markPaid(invoice.id, await createUser(role));
    expect(res.status).toBe(403);
    expect(await db.payment.count()).toBe(0);
  });

  it("moves an invoiced order to shipping_paid when its shipping invoice is paid", async () => {
    const { orderId, invoice: productInvoice } = await placedOrder();
    const admin = await createUser("admin");
    await markPaid(productInvoice.id, admin);
    await db.order.update({ where: { id: orderId }, data: { status: "invoiced", shippingTotal: new Prisma.Decimal("4200.00") } });
    const shipping = await db.invoice.create({
      data: { orderId, kind: "shipping", amount: new Prisma.Decimal("4200.00"), breakdown: {} },
    });

    expect((await markPaid(shipping.id, admin, { method: "manual" })).status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("shipping_paid");
  });

  it("refuses invoices on cancelled orders", async () => {
    const { orderId, invoice } = await placedOrder();
    await db.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
    const res = await markPaid(invoice.id, await createUser("finance"));
    expect((await res.json()).error.code).toBe("order_cancelled");
  });
});

describe("internal notes", () => {
  it("lets support write notes and audits the change", async () => {
    const { orderId } = await placedOrder();
    const support = await createUser("support");
    const res = await notesRoute(
      await request(`/api/admin/orders/${orderId}/notes`, { method: "PATCH", body: { notes: "Customer called about delivery" }, user: support }),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: orderId, action: "order.notes_updated" } });
    expect(audit.after).toEqual({ notes: "Customer called about delivery" });
  });
});

describe("orders CSV export", () => {
  it("exports filtered orders for staff and refuses customers", async () => {
    const { customer, orderNumber } = await placedOrder();
    const ops = await createUser("ops");

    const res = await exportRoute(await request("/api/admin/orders/export.csv?payment=unpaid", { user: ops }), { params: {} });
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toContain("order_number,created_at,status");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(orderNumber);
    expect(lines[1]).toContain("18500.00");

    const paidOnly = await exportRoute(await request("/api/admin/orders/export.csv?payment=paid", { user: ops }), { params: {} });
    expect((await paidOnly.text()).trim().split("\r\n")).toHaveLength(1);

    const denied = await exportRoute(await request("/api/admin/orders/export.csv", { user: customer }), { params: {} });
    expect(denied.status).toBe(403);
  });
});
