import type { NextResponse } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getCartRoute, PATCH as patchCartRoute, POST as addToCartRoute } from "@/app/api/cart/route";
import { GET as productRoute } from "@/app/api/products/[id]/route";
import { GET as productsRoute } from "@/app/api/products/route";
import { CART_COOKIE, decodeCart, encodeCart } from "@/server/cart";
import { listCatalog } from "@/server/catalog";
import { db, resetDatabase } from "./db";
import { createBatch, createProduct, request } from "./fixtures";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function catalogFixture() {
  const earbuds = await createProduct("Earbuds", ["18500.00", "21000.00"], "Electronics");
  const tote = await createProduct("Tote", ["6200.00"], "Fashion");
  const cooker = await createProduct("Rice cooker", ["24900.00", "28400.00"], "Home & Kitchen");
  await createBatch("sea", { cutoffInDays: 14 });
  return { earbuds, tote, cooker };
}

describe("catalogue filters", () => {
  it("filters by category and by price on the lowest option price", async () => {
    await catalogFixture();
    const fashion = await listCatalog({ category: "Fashion" });
    expect(fashion.products.map((p) => p.title)).toEqual(["Tote"]);
    expect(fashion.categories).toEqual(["Electronics", "Fashion", "Home & Kitchen"]);

    const midRange = await listCatalog({ minPrice: "10000", maxPrice: "25000" });
    expect(midRange.products.map((p) => p.title).sort()).toEqual(["Earbuds", "Rice cooker"]);
    expect(midRange.products.find((p) => p.title === "Rice cooker")?.fromPrice).toBe("24900.00");
  });

  it("shows nothing for air while no air batch is open, and everything once one opens", async () => {
    await catalogFixture();
    const air = await listCatalog({ shipMethod: "air" });
    expect(air.products).toHaveLength(0);
    expect(air.reason).toBe("no_open_batch");

    await createBatch("air", { cutoffInDays: 4 });
    expect((await listCatalog({ shipMethod: "air" })).products).toHaveLength(3);
  });

  it("applies 'batch closing within N days' against real cutoffs", async () => {
    await catalogFixture();
    expect((await listCatalog({ closingWithinDays: 7 })).products).toHaveLength(0);
    expect((await listCatalog({ closingWithinDays: 30 })).products).toHaveLength(3);
  });

  it("serves the same data over GET /api/products with a shipping note on every product", async () => {
    await catalogFixture();
    const res = await productsRoute(await request("/api/products?category=Electronics&minPrice=abc"), { params: {} });
    const body = await res.json();
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toMatchObject({ title: "Earbuds", fromPrice: "18500.00" });
    expect(body.products[0].priceNote).toMatch(/shipping is billed separately/i);
  });

  it("returns product detail with per-method batch availability", async () => {
    const { earbuds } = await catalogFixture();
    const res = await productRoute(await request(`/api/products/${earbuds.id}`), { params: { id: earbuds.id } });
    const body = await res.json();
    expect(body.variants.map((v: { price: string }) => v.price)).toEqual(["18500.00", "21000.00"]);
    expect(body.shipping).toEqual([
      expect.objectContaining({ method: "sea", available: true }),
      expect.objectContaining({ method: "air", available: false, batch: null }),
    ]);

    const missing = await productRoute(await request("/api/products/nope"), { params: { id: "nope" } });
    expect(missing.status).toBe(404);
  });
});

describe("cart", () => {
  it("keeps only ids and quantities in the cookie and prices everything on the server", async () => {
    const { earbuds, tote } = await catalogFixture();
    const [black] = earbuds.variants;

    const first = (await addToCartRoute(await request("/api/cart", { body: { variantId: black!.id, quantity: 2 } }), { params: {} })) as NextResponse;
    const cookie = first.cookies.get(CART_COOKIE)!.value;
    expect(decodeCart(cookie)).toEqual([{ variantId: black!.id, quantity: 2 }]);

    const second = (await addToCartRoute(
      await request("/api/cart", { body: { variantId: tote.variants[0]!.id, quantity: 3 }, cookie: `${CART_COOKIE}=${cookie}` }),
      { params: {} },
    )) as NextResponse;
    const body = await second.json();
    // 2 × 18500.00 + 3 × 6200.00
    expect(body.productTotal).toBe("55600.00");
    expect(body.itemCount).toBe(5);

    const updated = await patchCartRoute(
      await request("/api/cart", { method: "PATCH", body: { variantId: black!.id, quantity: 0 }, cookie: `${CART_COOKIE}=${second.cookies.get(CART_COOKIE)!.value}` }),
      { params: {} },
    );
    expect((await updated.json()).productTotal).toBe("18600.00");
  });

  it("drops options that became unavailable and ignores a tampered cookie", async () => {
    const { earbuds } = await catalogFixture();
    const variant = earbuds.variants[0]!;
    await db.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });

    const stale = await getCartRoute(
      await request("/api/cart", { cookie: `${CART_COOKIE}=${encodeCart([{ variantId: variant.id, quantity: 1 }])}` }),
      { params: {} },
    );
    expect((await stale.json()).lines).toEqual([]);

    const tampered = await getCartRoute(await request("/api/cart", { cookie: `${CART_COOKIE}=not-base64-json` }), { params: {} });
    expect((await tampered.json()).productTotal).toBe("0.00");
  });
});
