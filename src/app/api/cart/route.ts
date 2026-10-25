import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  CART_COOKIE,
  MAX_LINE_QUANTITY,
  cartCookieOptions,
  decodeCart,
  encodeCart,
  priceCart,
  setLineQuantity,
  type CartLine,
} from "@/server/cart";
import { db } from "@/lib/db";
import { HttpError, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});

async function respond(lines: CartLine[]) {
  const priced = await priceCart(lines);
  const res = NextResponse.json({
    lines: priced.lines,
    productTotal: priced.productTotal,
    itemCount: priced.lines.reduce((n, l) => n + l.quantity, 0),
  });
  const kept = lines.filter((l) => !priced.unavailable.includes(l.variantId));
  if (kept.length === 0) res.cookies.set(CART_COOKIE, "", { ...cartCookieOptions, maxAge: 0 });
  else res.cookies.set(CART_COOKIE, encodeCart(kept), cartCookieOptions);
  return res;
}

const current = (req: NextRequest) => decodeCart(req.cookies.get(CART_COOKIE)?.value);

export const GET = route(async (req) => respond(current(req)));

/** Add to cart: increases the quantity if the variant is already there. */
export const POST = route(async (req) => {
  const { variantId, quantity } = await readJson(req, lineSchema.extend({ quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }));
  const variant = await db.productVariant.findFirst({ where: { id: variantId, isActive: true, product: { isActive: true } } });
  if (!variant) throw new HttpError(404, "variant_unavailable", "That option is no longer available.");

  const lines = current(req);
  const existing = lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  return respond(setLineQuantity(lines, variantId, existing + quantity));
});

/** Set a line's quantity; 0 removes it. */
export const PATCH = route(async (req) => {
  const { variantId, quantity } = await readJson(req, lineSchema);
  return respond(setLineQuantity(current(req), variantId, quantity));
});

export const DELETE = route(async () => respond([]));
