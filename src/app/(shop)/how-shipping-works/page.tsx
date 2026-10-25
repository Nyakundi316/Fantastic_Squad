import type { Metadata } from "next";
import Link from "next/link";
import { AfterOrderSteps } from "@/components/orders/after-order-steps";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "How shipping works" };

export default function HowShippingWorksPage() {
  return (
    <div className="container pb-16 pt-10 sm:pt-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold sm:text-4xl">How shipping works</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          You pay the product price when you order. Shipping is billed later, once we know what your items actually weigh.
        </p>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-16">
        <div className="space-y-8 text-base">
          <section>
            <h2 className="text-xl font-semibold">Why we split shipping</h2>
            <p className="mt-2 text-muted-foreground">
              Freight from China is cheaper per kilo when goods travel together. We group everyone&rsquo;s orders into a batch,
              get one shipping quote for the whole batch, then divide it fairly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">How your share is worked out</h2>
            <p className="mt-2 text-muted-foreground">
              Our team in China weighs every item. Your share of the batch quote is proportional to your order&rsquo;s weight:
            </p>
            <p className="tabular mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
              your share = batch quote × your order weight ÷ total batch weight
            </p>
            <p className="mt-4 text-muted-foreground">
              Bulky but light items can be charged by volume instead, as carriers do. Your invoice shows the batch quote, the
              weights and the exact calculation, so you can check every number.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Sea or air</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <dt className="font-medium">Sea freight</dt>
                <dd className="mt-1 text-sm text-muted-foreground">30–45 days. The lowest cost per kilo, best for heavier items.</dd>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4">
                <dt className="font-medium">Air freight</dt>
                <dd className="mt-1 text-sm text-muted-foreground">7–14 days. Noticeably more per kilo, worth it for small urgent items.</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="self-start rounded-xl border border-border bg-surface p-5 text-sm lg:mt-1">
          <p className="font-medium">What we never do</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Show a shipping figure before your items are measured.</li>
            <li>Add a margin to the product price.</li>
            <li>Send a shipping invoice before the split has been checked and approved by our team.</li>
          </ul>
          <Button asChild className="mt-5 w-full">
            <Link href="/#catalog">Browse preorders</Link>
          </Button>
        </aside>
      </div>

      <div className="mt-16 border-t border-border pt-12">
        <AfterOrderSteps />
      </div>
    </div>
  );
}
