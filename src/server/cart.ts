import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { sortedImages, type ProductImage } from "@/server/catalog";

// The cart lives in an httpOnly cookie holding only variant ids and quantities.
// Prices are always looked up and totalled here, on the server (hard rule 1).

export const CART_COOKIE = "fz_cart";
export const MAX_CART_LINES = 30;
export const MAX_LINE_QUANTITY = 500;

const cartSchema = z
  .array(z.object({ v: z.string().uuid(), q: z.number().int().min(1).max(MAX_LINE_QUANTITY) }))
  .max(MAX_CART_LINES);

export type CartLine = { variantId: string; quantity: number };

export function decodeCart(raw: string | undefined): CartLine[] {
  if (!raw) return [];
  try {
    const parsed = cartSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data.map((l) => ({ variantId: l.v, quantity: l.q })) : [];
  } catch {
    return [];
  }
}

export function encodeCart(lines: CartLine[]): string {
  return Buffer.from(JSON.stringify(lines.map((l) => ({ v: l.variantId, q: l.quantity })))).toString("base64url");
}

export const cartCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export function setLineQuantity(lines: CartLine[], variantId: string, quantity: number): CartLine[] {
  const rest = lines.filter((l) => l.variantId !== variantId);
  if (quantity <= 0) return rest;
  const existingIndex = lines.findIndex((l) => l.variantId === variantId);
  const next = { variantId, quantity: Math.min(quantity, MAX_LINE_QUANTITY) };
  if (existingIndex === -1) return [...rest, next].slice(-MAX_CART_LINES);
  const copy = [...lines];
  copy[existingIndex] = next;
  return copy;
}

export type PricedCartLine = {
  variantId: string;
  productId: string;
  title: string;
  variantLabel: string;
  image: ProductImage | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export async function priceCart(lines: CartLine[]) {
  if (lines.length === 0) return { lines: [] as PricedCartLine[], productTotal: "0.00", unavailable: [] as string[] };

  const variants = await db.productVariant.findMany({
    where: { id: { in: lines.map((l) => l.variantId) }, isActive: true, product: { isActive: true } },
    include: { product: { select: { id: true, title: true, images: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  let total = new Prisma.Decimal(0);
  const priced: PricedCartLine[] = [];
  const unavailable: string[] = [];

  for (const line of lines) {
    const variant = byId.get(line.variantId);
    if (!variant) {
      unavailable.push(line.variantId);
      continue;
    }
    const lineTotal = variant.buyingPrice.mul(line.quantity);
    total = total.add(lineTotal);
    priced.push({
      variantId: variant.id,
      productId: variant.product.id,
      title: variant.product.title,
      variantLabel: variant.label,
      image: sortedImages(variant.product.images)[0] ?? null,
      quantity: line.quantity,
      unitPrice: variant.buyingPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    });
  }

  return { lines: priced, productTotal: total.toFixed(2), unavailable };
}
