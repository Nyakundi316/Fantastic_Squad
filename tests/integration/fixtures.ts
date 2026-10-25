import { Prisma, type Role, type ShipMethod, type User } from "@prisma/client";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { db } from "./db";

let phoneSeq = 100;

export async function createUser(role: Role = "customer", name = `${role} user`) {
  phoneSeq += 1;
  return db.user.create({ data: { role, name, phone: `+23480300${String(phoneSeq).padStart(5, "0")}` } });
}

export async function createAddress(user: User) {
  return db.address.create({
    data: { userId: user.id, fullName: user.name ?? "Test", phone: user.phone ?? "+2348030000000", line1: "1 Test Rd", city: "Ikeja", state: "Lagos", isDefault: true },
  });
}

export async function createProduct(title: string, prices: string[], category = "Electronics") {
  return db.product.create({
    data: {
      title,
      category,
      images: [{ url: "/products/x.svg", alt: title, order: 0 }],
      variants: { create: prices.map((p, i) => ({ label: `Option ${i + 1}`, buyingPrice: new Prisma.Decimal(p) })) },
    },
    include: { variants: { orderBy: { buyingPrice: "asc" } } },
  });
}

export async function createBatch(method: ShipMethod, opts: { cutoffInDays?: number; status?: "collecting" | "ordered"; name?: string } = {}) {
  return db.batch.create({
    data: {
      name: opts.name ?? `${method} batch`,
      defaultShipMethod: method,
      status: opts.status ?? "collecting",
      cutoffAt: new Date(Date.now() + (opts.cutoffInDays ?? 10) * 86_400_000),
    },
  });
}

export async function cookieFor(user: Pick<User, "id" | "role">) {
  return `${SESSION_COOKIE}=${await signSession({ userId: user.id, role: user.role })}`;
}

export async function request(
  path: string,
  opts: { method?: string; body?: unknown; user?: Pick<User, "id" | "role">; cookie?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  const cookies = [opts.user ? await cookieFor(opts.user) : null, opts.cookie].filter(Boolean);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** A shop with one sea batch, one customer with an address, and a two-variant product. */
export async function shopFixture() {
  const customer = await createUser("customer", "Ada");
  const address = await createAddress(customer);
  const product = await createProduct("Earbuds", ["18500.00", "19999.99"]);
  const seaBatch = await createBatch("sea");
  return { customer, address, product, seaBatch, cheap: product.variants[0]!, dear: product.variants[1]! };
}

/**
 * A sea batch holding `paid` + `unpaid` orders from different customers. Each
 * order has two lines: 2 × cheap option and 1 × dear option.
 */
export async function batchWithOrders({ paid, unpaid }: { paid: number; unpaid: number }) {
  const { placeOrder } = await import("@/server/orders/place-order");
  const product = await createProduct("Kettle", ["10000.00", "15000.00"]);
  const batch = await createBatch("sea");
  const orders = [];
  for (let i = 0; i < paid + unpaid; i++) {
    const customer = await createUser("customer", `Customer ${i + 1}`);
    const address = await createAddress(customer);
    const { order } = await placeOrder(customer, {
      items: [
        { variantId: product.variants[0]!.id, quantity: 2 },
        { variantId: product.variants[1]!.id, quantity: 1 },
      ],
      shipMethod: "sea",
      addressId: address.id,
      acknowledgedShippingLater: true,
    });
    if (i < paid) await db.invoice.updateMany({ where: { orderId: order.id }, data: { status: "paid", paidAt: new Date() } });
    orders.push({ ...order, customer, paid: i < paid });
  }
  return { batch, product, orders };
}

/**
 * A batch taken all the way to Invoiced: `count` paid orders, measured, quoted
 * at ₦30,000.00 split by weight, and approved. Returns the shipping invoices too.
 */
export async function invoicedBatch(count = 3) {
  const { transitionBatch, updateBatchSettings } = await import("@/server/batches/transitions");
  const { upsertMeasurements } = await import("@/server/batches/measurements");
  const { approveAllocation, previewAllocation } = await import("@/server/allocation/batch-allocation");

  const setup = await batchWithOrders({ paid: count, unpaid: 0 });
  const ops = await createUser("ops", "Tunde");
  await transitionBatch(setup.batch.id, "ordered", ops);
  const items = await db.orderItem.findMany({ where: { order: { batchId: setup.batch.id } }, orderBy: { id: "asc" } });
  await upsertMeasurements(setup.batch.id, items.map((item, i) => ({ orderItemId: item.id, weightG: 500 + i * 100 })), ops);
  await transitionBatch(setup.batch.id, "measured", ops);
  await updateBatchSettings(setup.batch.id, { shippingQuote: new Prisma.Decimal("30000.00"), allocationMethod: "weight" }, ops);
  const preview = await previewAllocation(setup.batch.id);
  await approveAllocation(setup.batch.id, ops, preview.fingerprint!);

  const invoices = await db.invoice.findMany({ where: { kind: "shipping", order: { batchId: setup.batch.id } }, include: { order: true } });
  return { ...setup, ops, invoices };
}
