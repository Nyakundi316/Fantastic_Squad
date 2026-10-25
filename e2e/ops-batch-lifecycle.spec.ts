import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { E2E_PAYSTACK } from "./env";
import { SEEDED, db, signIn } from "./support";

// One batch, start to finish, in order. Later phases extend this file.
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.afterAll(() => db.$disconnect());

const BATCH_NAME = "November Sea Batch";

test("ops closes the batch, imports measurements from CSV, corrects one and marks the batch measured", async ({ page }) => {
  const batch = await db.batch.findFirstOrThrow({ where: { name: BATCH_NAME } });
  const live = await db.order.findMany({ where: { batchId: batch.id, status: { not: "cancelled" } }, include: { invoices: true } });
  const paidCount = live.filter((o) => o.invoices.some((i) => i.kind === "product" && i.status === "paid")).length;
  const unpaidCount = live.length - paidCount;

  await signIn(page, SEEDED.ops);
  await page.goto("/admin/batches");
  const collecting = page.getByRole("region", { name: "Collecting" });
  await collecting.getByRole("link", { name: new RegExp(BATCH_NAME) }).click();

  await page.getByRole("button", { name: "Close batch and order" }).click();
  await expect(page.getByText(new RegExp(`^${paidCount} paid orders? (is|are) confirmed`))).toBeVisible();
  await expect(page.getByText(new RegExp(`^${unpaidCount} unpaid orders? (is|are) cancelled`))).toBeVisible();
  await page.getByRole("button", { name: "Confirm and close" }).click();
  await expect(page.getByRole("link", { name: "Enter measurements" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as measured" })).toBeDisabled();

  // Build the CSV the way ops would: from the template's order_item_id column.
  const items = await db.orderItem.findMany({
    where: { order: { batchId: batch.id, status: { not: "cancelled" } } },
    include: { order: { select: { orderNumber: true } } },
    orderBy: { id: "asc" },
  });
  expect(items.length).toBeGreaterThan(0);
  const csv = [
    "order_item_id,order_number,weight_g,length_mm,width_mm,height_mm",
    ...items.map((item, i) => `${item.id},${item.order.orderNumber},${300 + (i % 7) * 150},${250 + i},200,${120 + (i % 3) * 40}`),
  ].join("\n");

  await page.getByRole("link", { name: "Enter measurements" }).click();
  await page.getByLabel("Measurements CSV file").setInputFiles({ name: "measurements.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(`Imported ${items.length} rows`)).toBeVisible();
  await page.getByRole("button", { name: `Save ${items.length} rows` }).click();
  await expect(page.getByText(`Saved: ${items.length} new, 0 changed.`)).toBeVisible();

  // Correct one weight by hand; it must show up in the change history.
  const first = items[0]!;
  const weightInput = page.getByLabel(new RegExp(`^Weight \\(g\\) for ${first.order.orderNumber}`)).first();
  await weightInput.fill("999");
  await page.getByRole("button", { name: "Save 1 row" }).click();
  await expect(page.getByText("Saved: 0 new, 1 changed.")).toBeVisible();
  await expect(page.getByText("changed by Tunde Bakare").first()).toBeVisible();

  const audits = await db.auditLog.groupBy({
    by: ["action"],
    where: { entityType: "measurement", after: { path: ["batchId"], equals: batch.id } },
    _count: { _all: true },
  });
  expect(Object.fromEntries(audits.map((a) => [a.action, a._count._all]))).toEqual({
    "measurement.created": items.length,
    "measurement.updated": 1,
  });

  await page.getByRole("link", { name: BATCH_NAME }).click();
  await page.getByRole("button", { name: "Mark as measured" }).click();
  await expect(page.getByText("Unallocated")).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview allocation" })).toBeVisible();
  expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("measured");
});

test("ops enters the quote, previews the split and approves it; the customer sees the shipping invoice", async ({ page, browser }) => {
  const batch = await db.batch.findFirstOrThrow({ where: { name: BATCH_NAME } });
  const liveOrders = await db.order.count({ where: { batchId: batch.id, status: { not: "cancelled" } } });

  await signIn(page, SEEDED.ops);
  await page.goto(`/admin/batches/${batch.id}/allocation`);
  await expect(page.getByText("No invoice will be sent until you approve.")).toBeVisible();
  await expect(page.getByText("Can’t split the quote yet")).toBeVisible();

  await page.getByLabel("Batch shipping quote (₦)").fill("1250000.00");
  await page.getByLabel("Split method").selectOption("weight");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page.getByText("Matches the quote exactly")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(liveOrders + 2); // header + orders + footer

  await page.getByRole("button", { name: "Approve and send invoices" }).click();
  await page.getByRole("button", { name: "Yes, approve and send" }).click();
  await expect(page.getByText(/Approved by Tunde Bakare/)).toBeVisible();
  await expect(page.getByText(`${liveOrders} shipping invoices were sent`)).toBeVisible();

  const allocations = await db.shippingAllocation.findMany({ where: { batchId: batch.id } });
  expect(allocations).toHaveLength(liveOrders);
  expect(allocations.reduce((sum, a) => sum.add(a.allocatedAmount), new Prisma.Decimal(0)).toFixed(2)).toBe("1250000.00");
  expect(await db.invoice.count({ where: { kind: "shipping", order: { batchId: batch.id } } })).toBe(liveOrders);

  const customer = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await customer.newPage();
  await signIn(phone, SEEDED.customer);
  await phone.goto("/orders?filter=due");
  await phone.getByRole("link", { name: "Pay shipping" }).first().waitFor();
  const firstOrder = phone.getByRole("listitem").first();
  await firstOrder.getByRole("link").first().click();
  await expect(phone.getByText("Shipping invoice ready")).toBeVisible();
  await customer.close();
});

test("the customer pays shipping by card, a replayed webhook changes nothing, and ops ships and delivers the batch", async ({ page, browser, request }) => {
  const batch = await db.batch.findFirstOrThrow({ where: { name: BATCH_NAME } });
  const customer = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await customer.newPage();
  await signIn(phone, SEEDED.customer);

  await phone.goto("/orders?filter=due");
  await phone.getByRole("link", { name: "Pay shipping" }).first().click();
  await expect(phone.getByRole("heading", { name: "Shipping invoice" })).toBeVisible();
  await phone.getByText("How was this calculated?").click();
  await expect(phone.getByText(/^1250000\.00 × \d+ g ÷ \d+ g = /)).toBeVisible();

  const invoiceId = phone.url().split("/invoices/")[1]!.split("?")[0]!;
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await phone.getByRole("button", { name: /^Pay ₦[\d,.]+ by card or transfer$/ }).click();

  // Fake Paystack hosted page → pay → signed webhook → back to the invoice.
  await expect(phone.getByRole("heading", { name: "Fake Paystack checkout" })).toBeVisible();
  await phone.getByRole("button", { name: "Pay now" }).click();
  await expect(phone).toHaveURL(new RegExp(`/invoices/${invoiceId}[?]reference=`));
  await expect(phone.getByText("Paid", { exact: true }).first()).toBeVisible();
  expect((await db.order.findUniqueOrThrow({ where: { id: invoice.orderId } })).status).toBe("shipping_paid");

  const payment = await db.payment.findFirstOrThrow({ where: { invoiceId, status: "success" } });
  const replay = JSON.stringify({
    event: "charge.success",
    data: { id: 1, reference: payment.providerRef, amount: Number(payment.amount.mul(100).toFixed(0)), currency: "NGN", paid_at: new Date().toISOString() },
  });
  const res = await request.post("/api/payments/webhook", {
    headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", E2E_PAYSTACK.secret).update(replay).digest("hex") },
    data: replay,
  });
  expect(await res.json()).toEqual({ received: true, outcome: "duplicate" });
  expect(await db.payment.count({ where: { invoiceId, status: "success" } })).toBe(1);
  await customer.close();

  // Ops books, dispatches, and delivers.
  const unpaid = await db.order.count({ where: { batchId: batch.id, status: "invoiced" } });
  await signIn(page, SEEDED.ops);
  await page.goto("/admin/shipments");
  await page.getByLabel("Carrier").fill("Maersk");
  await page.getByLabel("Tracking number").fill("MSKU7781234");
  await page.getByRole("button", { name: "Book shipment" }).click();
  await page.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(page.getByText(new RegExp(`^1 paid order ships .* ${unpaid} unpaid orders? travels? with the batch`))).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Mark arrived" }).click();
  await page.getByRole("button", { name: "Mark delivered" }).first().click();
  await expect(page.getByText(/delivered \d/)).toBeVisible();

  expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("delivered");
  expect((await db.order.findUniqueOrThrow({ where: { id: invoice.orderId } })).status).toBe("delivered");
  expect(await db.order.count({ where: { batchId: batch.id, status: "invoiced" } })).toBe(unpaid);
  await expect(page.getByText("Awaiting payment").first()).toBeVisible();
});
