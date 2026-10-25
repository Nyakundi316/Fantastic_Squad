import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { requireViewer } from "@/server/auth/viewer";
import { listActiveBatches, openBatchByMethod } from "@/server/batches/active";
import { CART_COOKIE, decodeCart, priceCart } from "@/server/cart";
import { BULK_LINE_LIMIT, CUSTOMER_LINE_LIMIT } from "@/server/orders/place-order";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const viewer = await requireViewer("/checkout");
  const cart = await priceCart(decodeCart(cookies().get(CART_COOKIE)?.value));

  if (cart.lines.length === 0) {
    return (
      <div className="container max-w-xl py-16">
        <h1 className="text-2xl font-semibold">Nothing to check out yet</h1>
        <p className="mt-2 text-muted-foreground">Pick a product and join its preorder to start.</p>
        <Button asChild className="mt-6">
          <Link href="/#catalog">Browse preorders</Link>
        </Button>
      </div>
    );
  }

  const [addresses, batches] = await Promise.all([
    db.address.findMany({ where: { userId: viewer.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
    listActiveBatches(),
  ]);
  const open = openBatchByMethod(batches);
  const maxQuantity = can(viewer.role, "orders.bulk") ? BULK_LINE_LIMIT : CUSTOMER_LINE_LIMIT;

  return (
    <div className="container pb-16 pt-6 sm:pt-10">
      <h1 className="text-2xl font-semibold sm:text-3xl">Checkout</h1>
      <CheckoutForm
        lines={cart.lines}
        productTotal={cart.productTotal}
        maxQuantity={maxQuantity}
        viewerName={viewer.name ?? ""}
        viewerPhone={viewer.phone ?? ""}
        addresses={addresses.map((a) => ({
          id: a.id,
          fullName: a.fullName,
          phone: a.phone,
          summary: [a.line1, a.line2, a.city, a.state].filter(Boolean).join(", "),
          isDefault: a.isDefault,
        }))}
        methods={(["sea", "air"] as const).map((method) => {
          const batch = open[method];
          return {
            method,
            batchName: batch?.name ?? null,
            cutoff: batch ? formatDate(batch.cutoffAt, { weekday: "short", day: "numeric", month: "short" }) : null,
          };
        })}
      />
    </div>
  );
}
