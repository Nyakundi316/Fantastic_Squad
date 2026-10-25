import Link from "next/link";
import { cookies } from "next/headers";
import { Info, ShoppingBag } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { IdentifyViewer } from "@/components/analytics/identify-viewer";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { db } from "@/lib/db";
import { isStaff } from "@/lib/auth/roles";
import { getViewer } from "@/server/auth/viewer";
import { CART_COOKIE, decodeCart } from "@/server/cart";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const cartCount = decodeCart(cookies().get(CART_COOKIE)?.value).reduce((n, l) => n + l.quantity, 0);
  const unread = viewer ? await db.notification.count({ where: { userId: viewer.id, channel: "in_app", status: "queued" } }) : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      {viewer && <IdentifyViewer userId={viewer.id} role={viewer.role} />}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="container flex h-14 items-center gap-6">
          <Wordmark />
          <nav aria-label="Main" className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <Link href="/#catalog" className="hover:text-foreground">
              Preorders
            </Link>
            <Link href="/how-shipping-works" className="hover:text-foreground">
              How shipping works
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm sm:gap-4">
            {cartCount > 0 && (
              <Link href="/checkout" className="inline-flex items-center gap-1.5 font-medium hover:text-primary" aria-label={`Checkout, ${cartCount} items`}>
                <ShoppingBag className="size-4" aria-hidden />
                <span className="tabular">{cartCount}</span>
              </Link>
            )}
            {viewer ? (
              <>
                <NotificationBell initialUnread={unread} />
                {isStaff(viewer.role) && (
                  <Link href="/admin" className="font-medium text-primary hover:underline">
                    Admin
                  </Link>
                )}
                <Link href="/orders" className="font-medium hover:text-primary">
                  My orders
                </Link>
                <Link href="/account" className="hidden text-muted-foreground hover:text-foreground sm:inline">
                  Account
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-lg border border-border px-3 font-medium hover:bg-muted"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        <p className="border-t border-border bg-info-soft/60 text-xs text-foreground/80">
          <span className="container flex items-center gap-2 py-1.5">
            <Info className="size-3.5 shrink-0 text-info" aria-hidden />
            Prices shown are product prices only. Shipping is billed separately once your batch is measured.
          </span>
        </p>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-border bg-surface">
        <div className="container grid gap-6 py-8 text-sm text-muted-foreground sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-2">
            <Wordmark />
            <p className="max-w-xs">Shop Smart. Save More. Preorders from China at buying price, shipped together.</p>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Shipping</p>
            <p>Sea: 30–45 days</p>
            <p>Air: 7–14 days, costlier</p>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Account</p>
            <Link href="/orders" className="block hover:text-foreground">
              Orders
            </Link>
            <Link href="/account" className="block hover:text-foreground">
              Profile and addresses
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
