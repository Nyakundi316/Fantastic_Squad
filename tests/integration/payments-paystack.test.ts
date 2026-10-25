import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as markPaidRoute } from "@/app/api/admin/invoices/[id]/mark-paid/route";
import { GET as exportRoute } from "@/app/api/admin/payments/export.csv/route";
import { POST as initiateRoute } from "@/app/api/payments/initiate/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { db, resetDatabase } from "./db";
import { createUser, invoicedBatch, request } from "./fixtures";

const SECRET = "sk_test_fantasticzone_vitest";
const noParams = { params: {} };

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

function stubPaystackInitialize() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(String(input)).toBe("https://paystack.test/transaction/initialize");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    return new Response(
      JSON.stringify({ status: true, message: "ok", data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, access_code: "ac_1", reference: body.reference } }),
      { status: 200 },
    );
  });
}

function webhook(payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? createHmac("sha512", SECRET).update(raw).digest("hex");
  return new NextRequest("http://localhost:3000/api/payments/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": sig },
    body: raw,
  });
}

const charge = (reference: string, amountKobo: string, currency = "NGN") => ({
  event: "charge.success",
  data: { id: 4099260516, reference, amount: Number(amountKobo), currency, channel: "card", paid_at: "2026-11-01T10:15:00.000Z", status: "success" },
});

async function startCardPayment() {
  const setup = await invoicedBatch(3);
  const invoice = setup.invoices[0]!;
  const owner = await db.user.findUniqueOrThrow({ where: { id: invoice.order.userId } });
  const fetchSpy = stubPaystackInitialize();
  const res = await initiateRoute(await request("/api/payments/initiate", { body: { invoiceId: invoice.id, provider: "paystack" }, user: owner }), noParams);
  expect(res.status).toBe(200);
  const { checkoutUrl, reference } = await res.json();
  return { ...setup, invoice, owner, checkoutUrl, reference, fetchSpy };
}

describe("POST /api/payments/initiate", () => {
  it("creates a pending payment with a unique reference and returns the Paystack checkout URL, amount in kobo", async () => {
    const { invoice, checkoutUrl, reference, fetchSpy } = await startCardPayment();
    expect(checkoutUrl).toBe(`https://checkout.paystack.test/${reference}`);
    expect(reference).toMatch(new RegExp(`^${invoice.order.orderNumber}-S1-[0-9a-f]{8}$`));

    const sent = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
    expect(sent.amount).toBe(invoice.amount.mul(100).toFixed(0));
    expect(sent.callback_url).toBe(`http://localhost:3000/invoices/${invoice.id}?reference=${reference}`);

    const payment = await db.payment.findFirstOrThrow({ where: { providerRef: reference } });
    expect(payment).toMatchObject({ status: "pending", provider: "paystack", method: "card", kind: "shipping", invoiceId: invoice.id });
  });

  it("refuses other people's invoices, paid invoices and unknown providers", async () => {
    const setup = await invoicedBatch(2);
    const [first] = setup.invoices;
    const stranger = await createUser();
    stubPaystackInitialize();

    const notMine = await initiateRoute(await request("/x", { body: { invoiceId: first!.id }, user: stranger }), noParams);
    expect(notMine.status).toBe(404);

    const owner = await db.user.findUniqueOrThrow({ where: { id: first!.order.userId } });
    const flutter = await initiateRoute(await request("/x", { body: { invoiceId: first!.id, provider: "flutterwave" }, user: owner }), noParams);
    expect((await flutter.json()).error.code).toBe("provider_unavailable");

    await db.invoice.update({ where: { id: first!.id }, data: { status: "paid", paidAt: new Date() } });
    const paid = await initiateRoute(await request("/x", { body: { invoiceId: first!.id }, user: owner }), noParams);
    expect((await paid.json()).error.code).toBe("invoice_not_payable");
  });

  it("marks the payment failed and returns 502 when Paystack is unreachable", async () => {
    const setup = await invoicedBatch(1);
    const invoice = setup.invoices[0]!;
    const owner = await db.user.findUniqueOrThrow({ where: { id: invoice.order.userId } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: false, message: "Invalid key" }), { status: 401 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await initiateRoute(await request("/x", { body: { invoiceId: invoice.id }, user: owner }), noParams);
    expect(res.status).toBe(502);
    expect((await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } })).status).toBe("failed");
  });
});

describe("POST /api/payments/webhook", () => {
  it("rejects a bad or missing signature without touching anything", async () => {
    const { reference, invoice } = await startCardPayment();
    const kobo = invoice.amount.mul(100).toFixed(0);

    expect((await webhookRoute(webhook(charge(reference, kobo), "0".repeat(128)))).status).toBe(401);
    expect((await webhookRoute(webhook(charge(reference, kobo), "not-hex"))).status).toBe(401);
    const unsigned = new NextRequest("http://localhost:3000/api/payments/webhook", { method: "POST", body: JSON.stringify(charge(reference, kobo)) });
    expect((await webhookRoute(unsigned)).status).toBe(401);

    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("issued");
    expect((await db.payment.findFirstOrThrow({ where: { providerRef: reference } })).status).toBe("pending");
  });

  it("settles a verified charge: payment success, invoice paid, order shipping_paid, shipping_paid queued", async () => {
    const { reference, invoice, owner } = await startCardPayment();
    const res = await webhookRoute(webhook(charge(reference, invoice.amount.mul(100).toFixed(0))));
    expect(await res.json()).toEqual({ received: true, outcome: "settled" });

    const payment = await db.payment.findFirstOrThrow({ where: { providerRef: reference } });
    expect(payment.status).toBe("success");
    expect(payment.paidAt?.toISOString()).toBe("2026-11-01T10:15:00.000Z");
    expect(payment.metadata).toMatchObject({ paystackId: "4099260516", channel: "card" });

    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("paid");
    expect((await db.order.findUniqueOrThrow({ where: { id: invoice.orderId } })).status).toBe("shipping_paid");
    expect(await db.notification.count({ where: { userId: owner.id, template: "shipping_paid" } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "payment.webhook_settled", entityId: invoice.id } })).toBe(1);
  });

  it("is idempotent: replaying the same event credits nothing twice", async () => {
    const { reference, invoice, owner } = await startCardPayment();
    const event = charge(reference, invoice.amount.mul(100).toFixed(0));

    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push((await (await webhookRoute(webhook(event))).json()).outcome);
    // And two arriving at the same moment.
    const concurrent = await Promise.all([webhookRoute(webhook(event)), webhookRoute(webhook(event))]);
    for (const r of concurrent) outcomes.push((await r.json()).outcome);

    expect(outcomes).toEqual(["settled", "duplicate", "duplicate", "duplicate", "duplicate"]);
    expect(await db.payment.count({ where: { invoiceId: invoice.id, status: "success" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: owner.id, template: "shipping_paid" } })).toBe(2);
  });

  it("refuses a charge whose amount or currency doesn't match", async () => {
    const { reference, invoice } = await startCardPayment();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await webhookRoute(webhook(charge(reference, "100")));
    expect((await res.json()).outcome).toBe("amount_mismatch");
    expect((await db.payment.findFirstOrThrow({ where: { providerRef: reference } })).status).toBe("failed");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("issued");
  });

  it("keeps money that arrives for an already-paid invoice, flagged as unapplied", async () => {
    const { reference, invoice } = await startCardPayment();
    const finance = await createUser("finance");
    await markPaidRoute(await request("/x", { body: { method: "bank_transfer" }, user: finance }), { params: { id: invoice.id } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await webhookRoute(webhook(charge(reference, invoice.amount.mul(100).toFixed(0))));
    expect((await res.json()).outcome).toBe("unapplied");
    const card = await db.payment.findFirstOrThrow({ where: { providerRef: reference } });
    expect(card.status).toBe("success");
    expect(card.metadata).toMatchObject({ unapplied: true, invoiceStatus: "paid" });
    expect(await db.auditLog.count({ where: { action: "payment.unapplied" } })).toBe(1);
  });

  it("acknowledges unknown references and other event types without changes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await (await webhookRoute(webhook(charge("NOPE-123", "1000")))).json()).outcome).toBe("unknown_reference");
    expect((await (await webhookRoute(webhook({ event: "transfer.success", data: {} }))).json()).outcome).toBe("ignored");
  });

  it("releases a held order as shipped when its batch already left", async () => {
    const { reference, invoice } = await startCardPayment();
    await db.batch.update({ where: { id: invoice.order.batchId! }, data: { status: "shipped" } });
    await webhookRoute(webhook(charge(reference, invoice.amount.mul(100).toFixed(0))));
    expect((await db.order.findUniqueOrThrow({ where: { id: invoice.orderId } })).status).toBe("shipped");
  });
});

describe("GET /api/admin/payments/export.csv", () => {
  it("exports the ledger for finance and refuses ops", async () => {
    const { reference, invoice } = await startCardPayment();
    await webhookRoute(webhook(charge(reference, invoice.amount.mul(100).toFixed(0))));

    const finance = await createUser("finance");
    const res = await exportRoute(await request("/api/admin/payments/export.csv?method=card", { user: finance }), noParams);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("created_at,paid_at,order_number,customer,kind,invoice_version,method,provider,provider_ref,status,amount,currency,unapplied");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`${reference},success,${invoice.amount.toFixed(2)},NGN`);

    expect((await exportRoute(await request("/x", { user: await createUser("ops") }), noParams)).status).toBe(403);
  });
});
