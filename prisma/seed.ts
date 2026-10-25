/* Development seed: 3 products, 1 collecting batch, 5 users, 20 orders. Wipes all data first. */
import { Prisma, PrismaClient, type Role } from "@prisma/client";
import { DEFAULT_TEMPLATES } from "../src/server/notifications/templates";

const db = new PrismaClient();
const D = (v: string | number) => new Prisma.Decimal(v);
const DAY = 86_400_000;

// Deterministic so every developer gets the same seed data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(1042);
const pick = (n: number) => Math.floor(random() * n);

const PEOPLE: Array<{ name: string; phone: string; email: string; role: Role }> = [
  { name: "Funmi Adeyemi", phone: "+2348030000001", email: "admin@fantasticzone.ng", role: "admin" },
  { name: "Tunde Bakare", phone: "+2348030000002", email: "ops@fantasticzone.ng", role: "ops" },
  { name: "Amaka Obi", phone: "+2348030000003", email: "finance@fantasticzone.ng", role: "finance" },
  { name: "Ada Okafor", phone: "+2348030000004", email: "ada@example.com", role: "customer" },
  { name: "Chidi Nwosu", phone: "+2348030000005", email: "chidi@example.com", role: "dropshipper" },
];

const PRODUCTS = [
  {
    title: "Wireless Earbuds with Noise Cancelling",
    category: "Electronics",
    description:
      "Bluetooth 5.3 earbuds with active noise cancelling, 30-hour battery with the case and USB-C charging. Ships with three ear-tip sizes.",
    images: [
      { url: "/products/earbuds-1.svg", alt: "Earbuds in an open charging case", order: 0 },
      { url: "/products/earbuds-2.svg", alt: "Single earbud, side view", order: 1 },
    ],
    variants: [
      { sku: "EB-ANC-BLK", label: "Black", price: "18500.00" },
      { sku: "EB-ANC-WHT", label: "White", price: "18500.00" },
    ],
  },
  {
    title: "Stainless Steel Rice Cooker",
    category: "Home & Kitchen",
    description:
      "Non-stick inner pot, keep-warm mode and a steaming tray. 220V with a Nigerian 3-pin plug adaptor included.",
    images: [
      { url: "/products/rice-cooker-1.svg", alt: "Rice cooker with lid closed", order: 0 },
      { url: "/products/rice-cooker-2.svg", alt: "Rice cooker inner pot", order: 1 },
    ],
    variants: [
      { sku: "RC-18L", label: "1.8 L", price: "24900.00" },
      { sku: "RC-22L", label: "2.2 L", price: "28400.00" },
    ],
  },
  {
    title: "Heavy Canvas Tote Bag",
    category: "Fashion",
    description: "16 oz canvas, inner zip pocket and reinforced handles. Fits a 15-inch laptop.",
    images: [
      { url: "/products/tote-1.svg", alt: "Canvas tote bag, front", order: 0 },
      { url: "/products/tote-2.svg", alt: "Tote bag interior pocket", order: 1 },
    ],
    variants: [
      { sku: "TB-BEI", label: "Beige", price: "6200.00" },
      { sku: "TB-BLK", label: "Black", price: "6200.00" },
      { sku: "TB-OLV", label: "Olive", price: "6500.00" },
    ],
  },
];

async function wipe() {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE skips the row-level immutability triggers on invoices and allocations, which is what a reset needs.
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.$executeRawUnsafe(`ALTER SEQUENCE "order_number_seq" RESTART WITH 1001`);
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
    throw new Error("Refusing to seed a production database.");
  }

  await wipe();
  const now = Date.now();

  await db.setting.create({
    data: { currency: process.env.CURRENCY ?? "NGN", volumetricDivisor: 5000, notificationTemplates: DEFAULT_TEMPLATES },
  });

  const users = await Promise.all(
    PEOPLE.map((p) =>
      db.user.create({
        data: { ...p, phoneVerifiedAt: new Date(now - 30 * DAY), createdAt: new Date(now - 30 * DAY) },
      }),
    ),
  );
  const byRole = Object.fromEntries(users.map((u) => [u.role, u])) as Record<Role, (typeof users)[number]>;
  const ops = byRole.ops;
  const finance = byRole.finance;

  const [adaAddress, chidiAddress] = await Promise.all([
    db.address.create({
      data: {
        userId: byRole.customer.id,
        fullName: "Ada Okafor",
        phone: "+2348030000004",
        line1: "14 Adeola Odeku Street",
        line2: "Flat 3B",
        city: "Victoria Island",
        state: "Lagos",
        postalCode: "101241",
        isDefault: true,
      },
    }),
    db.address.create({
      data: {
        userId: byRole.dropshipper.id,
        fullName: "Chidi Nwosu",
        phone: "+2348030000005",
        line1: "Plot 22, Aminu Kano Crescent",
        city: "Wuse II",
        state: "FCT Abuja",
        postalCode: "904101",
        isDefault: true,
      },
    }),
  ]);

  const products = [];
  for (const p of PRODUCTS) {
    products.push(
      await db.product.create({
        data: {
          title: p.title,
          category: p.category,
          description: p.description,
          images: p.images,
          variants: { create: p.variants.map((v) => ({ sku: v.sku, label: v.label, buyingPrice: D(v.price) })) },
        },
        include: { variants: true },
      }),
    );
  }
  const catalog = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));

  const batchOpened = new Date(now - 11 * DAY);
  const batch = await db.batch.create({
    data: {
      name: "November Sea Batch",
      cutoffAt: new Date(now + 14 * DAY),
      defaultShipMethod: "sea",
      createdById: ops.id,
      createdAt: batchOpened,
    },
  });
  await db.auditLog.create({
    data: {
      actorId: ops.id,
      action: "batch.created",
      entityType: "batch",
      entityId: batch.id,
      after: { name: batch.name, cutoffAt: batch.cutoffAt.toISOString() },
      createdAt: batchOpened,
    },
  });

  for (let i = 0; i < 20; i++) {
    const isDropshipper = i % 5 >= 3; // 12 customer orders, 8 dropshipper orders
    const owner = isDropshipper ? byRole.dropshipper : byRole.customer;
    const address = isDropshipper ? chidiAddress : adaAddress;
    const placedAt = new Date(batchOpened.getTime() + (i + 1) * 12 * 60 * 60 * 1000 + pick(3_600_000));

    const lineCount = 1 + pick(3);
    const chosen = new Set<number>();
    while (chosen.size < lineCount) chosen.add(pick(catalog.length));

    const lines = [...chosen].map((index) => {
      const { product, variant } = catalog[index]!;
      const quantity = isDropshipper ? 4 + pick(9) : 1 + pick(3);
      return {
        product,
        variant,
        quantity,
        unitPrice: variant.buyingPrice,
        lineTotal: variant.buyingPrice.mul(quantity),
      };
    });
    const productTotal = lines.reduce((sum, l) => sum.add(l.lineTotal), D(0));

    const order = await db.order.create({
      data: {
        userId: owner.id,
        batchId: batch.id,
        shipMethod: "sea",
        productTotal,
        shipAddressId: address.id,
        createdAt: placedAt,
        updatedAt: placedAt,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            variantId: l.variant.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            createdAt: placedAt,
          })),
        },
      },
    });

    const paid = i < 16;
    const paidAt = new Date(placedAt.getTime() + 2 * 60 * 60 * 1000);
    const invoice = await db.invoice.create({
      data: {
        orderId: order.id,
        kind: "product",
        amount: productTotal,
        currency: "NGN",
        status: paid ? "paid" : "issued",
        issuedAt: placedAt,
        dueAt: new Date(placedAt.getTime() + 2 * DAY),
        paidAt: paid ? paidAt : null,
        createdAt: placedAt,
        breakdown: {
          kind: "product",
          lines: lines.map((l) => ({
            title: l.product.title,
            variant: l.variant.label,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toFixed(2),
            lineTotal: l.lineTotal.toFixed(2),
          })),
          total: productTotal.toFixed(2),
          note: "Product price only. Shipping is invoiced separately after measurement.",
        },
      },
    });

    if (paid) {
      const payment = await db.payment.create({
        data: {
          orderId: order.id,
          invoiceId: invoice.id,
          kind: "product",
          amount: productTotal,
          method: "manual",
          status: "success",
          paidAt,
          createdAt: paidAt,
          metadata: { recordedBy: finance.id, note: "Bank transfer confirmed" },
        },
      });
      await db.auditLog.create({
        data: {
          actorId: finance.id,
          action: "payment.marked_paid",
          entityType: "payment",
          entityId: payment.id,
          after: { orderNumber: order.orderNumber, amount: productTotal.toFixed(2) },
          createdAt: paidAt,
        },
      });
    }
  }

  const orders = await db.order.count();
  console.info(`Seeded ${users.length} users, ${products.length} products, 1 batch, ${orders} orders.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
