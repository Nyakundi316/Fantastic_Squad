import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adjustRoute } from "@/app/api/admin/invoices/[id]/adjust/route";
import { POST as resendRoute } from "@/app/api/admin/invoices/resend/route";
import { POST as markPaidRoute } from "@/app/api/admin/invoices/[id]/mark-paid/route";
import { POST as deliverRoute } from "@/app/api/admin/orders/[id]/deliver/route";
import { POST as createShipmentRoute } from "@/app/api/admin/shipments/route";
import { PATCH as patchShipmentRoute } from "@/app/api/admin/shipments/[id]/route";
import { GET as pdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import { GET as invoiceRoute } from "@/app/api/invoices/[id]/route";
import { db, resetDatabase } from "./db";
import { createUser, invoicedBatch, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const noParams = { params: {} };

async function payShipping(invoiceId: string) {
  const finance = await createUser("finance");
  const res = await markPaidRoute(await request("/x", { body: { method: "bank_transfer" }, user: finance }), { params: { id: invoiceId } });
  expect(res.status).toBe(200);
}

describe("shipments", () => {
  it("dispatch ships paid orders, holds unpaid ones, and delivery completes the paid ones", async () => {
    const { batch, invoices, ops } = await invoicedBatch(3);
    const [paidA, paidB, unpaid] = invoices;
    await payShipping(paidA!.id);
    await payShipping(paidB!.id);

    const created = await createShipmentRoute(
      await request("/api/admin/shipments", { body: { batchId: batch.id, carrier: "Maersk", trackingNumber: "MSKU1234567", estimatedDays: 38 }, user: ops }),
      noParams,
    );
    expect(created.status).toBe(201);
    const { shipment } = await created.json();
    expect(shipment).toMatchObject({ status: "pending", method: "sea", carrier: "Maersk" });

    const advance = async (status: string) =>
      patchShipmentRoute(await request("/x", { method: "PATCH", body: { status }, user: ops }), { params: { id: shipment.id } });

    const dispatched = await (await advance("in_transit")).json();
    expect(dispatched.summary).toEqual({ shipped: 2, held: 1 });
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("shipped");
    expect((await db.order.findUniqueOrThrow({ where: { id: unpaid!.orderId } })).status).toBe("invoiced");
    const dispatchNotes = await db.notification.findMany({ where: { template: "shipment_dispatched", channel: "whatsapp" } });
    expect(dispatchNotes).toHaveLength(2);
    expect(dispatchNotes[0]!.payload).toMatchObject({ trackingNumber: "MSKU1234567", estimatedDays: 38, shipMethod: "sea" });

    expect((await advance("delivered")).status).toBe(409); // must pass through "arrived"
    expect((await advance("arrived")).status).toBe(200);
    const delivered = await (await advance("delivered")).json();
    expect(delivered.summary).toEqual({ delivered: 2, held: 1 });
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("delivered");
    expect(await db.order.count({ where: { batchId: batch.id, status: "delivered" } })).toBe(2);
    expect(await db.notification.count({ where: { template: "shipment_delivered", channel: "whatsapp" } })).toBe(2);

    // The held customer pays later: released as shipped, then ops hands it over.
    await payShipping(unpaid!.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: unpaid!.orderId } })).status).toBe("shipped");
    const release = await deliverRoute(await request("/x", { method: "POST", user: ops }), { params: { id: unpaid!.orderId } });
    expect(release.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: unpaid!.orderId } })).status).toBe("delivered");

    expect(await db.auditLog.count({ where: { action: "shipment.status_changed", entityId: shipment.id } })).toBe(3);
  });

  it("only books a shipment for an invoiced batch, once", async () => {
    const { batch, ops } = await invoicedBatch(1);
    const book = async () => createShipmentRoute(await request("/x", { body: { batchId: batch.id }, user: ops }), noParams);
    expect((await book()).status).toBe(201);
    expect((await (await book()).json()).error.code).toBe("shipment_exists");

    await resetDatabase();
    const { batchWithOrders } = await import("./fixtures");
    const collecting = await batchWithOrders({ paid: 1, unpaid: 0 });
    const ops2 = await createUser("ops");
    const early = await createShipmentRoute(await request("/x", { body: { batchId: collecting.batch.id }, user: ops2 }), noParams);
    expect((await early.json()).error.code).toBe("batch_not_invoiced");
  });

  it("is for admin and ops only, and a delivered shipment can't be edited", async () => {
    const { batch, ops } = await invoicedBatch(1);
    for (const role of ["finance", "support"] as const) {
      expect((await createShipmentRoute(await request("/x", { body: { batchId: batch.id }, user: await createUser(role) }), noParams)).status).toBe(403);
    }
    const { shipment } = await (await createShipmentRoute(await request("/x", { body: { batchId: batch.id }, user: ops }), noParams)).json();
    for (const status of ["in_transit", "arrived", "delivered"]) {
      await patchShipmentRoute(await request("/x", { method: "PATCH", body: { status }, user: ops }), { params: { id: shipment.id } });
    }
    const late = await patchShipmentRoute(await request("/x", { method: "PATCH", body: { trackingNumber: "X" }, user: ops }), { params: { id: shipment.id } });
    expect((await late.json()).error.code).toBe("shipment_closed");
  });
});

describe("invoices", () => {
  it("shows the owner the breakdown with per-item costs that add up to the invoice, and hides it from others", async () => {
    const { invoices } = await invoicedBatch(2);
    const invoice = invoices[0]!;
    const owner = await db.user.findUniqueOrThrow({ where: { id: invoice.order.userId } });

    const res = await invoiceRoute(await request("/x", { user: owner }), { params: { id: invoice.id } });
    const body = (await res.json()).invoice;
    expect(body).toMatchObject({ kind: "shipping", version: 1, status: "issued", amount: invoice.amount.toFixed(2) });
    expect(body.breakdown).toMatchObject({ batchQuote: "30000.00", method: "weight" });
    const itemTotal = body.items.reduce((s: Prisma.Decimal, i: { cost: string }) => s.add(i.cost), new Prisma.Decimal(0));
    expect(itemTotal.toFixed(2)).toBe(invoice.amount.toFixed(2));

    const stranger = await createUser();
    expect((await invoiceRoute(await request("/x", { user: stranger }), { params: { id: invoice.id } })).status).toBe(404);
    expect((await invoiceRoute(await request("/x", { user: await createUser("support") }), { params: { id: invoice.id } })).status).toBe(200);
  });

  it("renders a PDF for the owner", async () => {
    const { invoices } = await invoicedBatch(1);
    const invoice = invoices[0]!;
    const owner = await db.user.findUniqueOrThrow({ where: { id: invoice.order.userId } });
    const res = await pdfRoute(await request("/x", { user: owner }), { params: { id: invoice.id } });
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`${invoice.order.orderNumber}-shipping-v1.pdf`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("adjusts by issuing a new version that supersedes the old one (hard rule 3)", async () => {
    const { invoices } = await invoicedBatch(1);
    const old = invoices[0]!;
    const finance = await createUser("finance");

    const res = await adjustRoute(await request("/x", { body: { amount: "9000.00", reason: "One item arrived damaged; credit applied" }, user: finance }), { params: { id: old.id } });
    expect(res.status).toBe(201);
    const { invoice: next } = await res.json();
    expect(next).toMatchObject({ version: 2, amount: "9000.00", supersedesId: old.id });

    const previous = await db.invoice.findUniqueOrThrow({ where: { id: old.id } });
    expect(previous.status).toBe("adjusted");
    expect(previous.amount.toFixed(2)).toBe(old.amount.toFixed(2)); // untouched
    const order = await db.order.findUniqueOrThrow({ where: { id: old.orderId } });
    expect(order.shippingTotal.toFixed(2)).toBe("9000.00");
    expect(order.grandTotal.toFixed(2)).toBe(order.productTotal.add("9000.00").toFixed(2));
    const v2 = await db.invoice.findUniqueOrThrow({ where: { id: next.id } });
    expect(v2.breakdown).toMatchObject({ amount: "9000.00", adjustment: { previousVersion: 1, reason: "One item arrived damaged; credit applied" } });
    expect(await db.auditLog.count({ where: { action: "invoice.adjusted", entityId: next.id } })).toBe(1);

    const again = await adjustRoute(await request("/x", { body: { amount: "8000.00", reason: "Second try on old version" }, user: finance }), { params: { id: old.id } });
    expect((await again.json()).error.code).toBe("invoice_not_adjustable");

    const ops = await createUser("ops");
    expect((await adjustRoute(await request("/x", { body: { amount: "1.00", reason: "Not allowed here" }, user: ops }), { params: { id: next.id } })).status).toBe(403);
  });

  it("resends unpaid shipping invoices and skips the rest", async () => {
    const { invoices } = await invoicedBatch(3);
    await payShipping(invoices[0]!.id);
    const before = await db.notification.count({ where: { template: "shipping_invoice_ready" } });

    const finance = await createUser("finance");
    const res = await resendRoute(await request("/x", { body: { invoiceIds: invoices.map((i) => i.id) }, user: finance }), noParams);
    expect(await res.json()).toEqual({ sent: 2, skipped: 1 });
    expect((await db.notification.count({ where: { template: "shipping_invoice_ready" } })) - before).toBe(6);
    expect(await db.auditLog.count({ where: { action: "invoice.resent" } })).toBe(2);
  });
});
