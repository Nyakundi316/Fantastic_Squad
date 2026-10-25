"use client";

import { useMutation } from "@tanstack/react-query";
import { Anchor, Minus, Plane, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AddressForm } from "@/components/account/address-form";
import { ProductImage } from "@/components/catalog/product-image";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { api, type ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PricedCartLine } from "@/server/cart";

type AddressOption = { id: string; fullName: string; phone: string; summary: string; isDefault: boolean };
type MethodOption = { method: "sea" | "air"; batchName: string | null; cutoff: string | null };

const METHOD_COPY = {
  sea: { label: "Sea freight", eta: "30–45 days", note: "Lower cost per kg", icon: Anchor },
  air: { label: "Air freight", eta: "7–14 days", note: "Faster, costs more per kg", icon: Plane },
} as const;

function SectionHeading({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-baseline gap-3 text-lg font-semibold">
      <span className="tabular text-sm font-medium text-muted-foreground">{step}</span>
      {children}
    </h2>
  );
}

export function CheckoutForm(props: {
  lines: PricedCartLine[];
  productTotal: string;
  maxQuantity: number;
  addresses: AddressOption[];
  methods: MethodOption[];
  viewerName: string;
  viewerPhone: string;
}) {
  const { lines, productTotal, maxQuantity, addresses, methods } = props;
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const [addressId, setAddressId] = useState(addresses[0]?.id ?? null);
  const [addingAddress, setAddingAddress] = useState(addresses.length === 0);
  const firstOpen = methods.find((m) => m.batchName)?.method ?? null;
  const [shipMethod, setShipMethod] = useState<"sea" | "air" | null>(firstOpen);
  const [acknowledged, setAcknowledged] = useState(false);

  const overLimit = lines.some((l) => l.quantity > maxQuantity);

  const updateLine = useMutation<unknown, ApiError, { variantId: string; quantity: number }>({
    mutationFn: (body) => api("/api/cart", { method: "PATCH", body }),
    onSuccess: () => startRefresh(() => router.refresh()),
  });

  const placeOrder = useMutation<{ order: { id: string } }, ApiError>({
    mutationFn: () =>
      api("/api/orders", {
        body: {
          items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          shipMethod,
          addressId,
          acknowledgedShippingLater: acknowledged,
        },
      }),
    onSuccess: ({ order }) => {
      track("preorder_placed", { orderId: order.id, shipMethod: shipMethod ?? "", lines: lines.length });
      router.push(`/orders/${order.id}?placed=1`);
    },
  });

  const blockers = [
    !addressId && "Add a delivery address.",
    !shipMethod && "Choose a shipping method.",
    overLimit && `Reduce quantities to ${maxQuantity} or fewer per item.`,
  ].filter(Boolean) as string[];
  const canSubmit = acknowledged && blockers.length === 0 && !placeOrder.isPending && !refreshing;
  const busy = updateLine.isPending || refreshing;

  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
      <div className="space-y-10">
        <section aria-labelledby="items-heading">
          <SectionHeading step={1}>
            <span id="items-heading">Items</span>
          </SectionHeading>
          <ul className={cn("mt-4 divide-y divide-border rounded-xl border border-border bg-surface", busy && "opacity-70")}>
            {lines.map((line) => (
              <li key={line.variantId} className="grid grid-cols-[64px_1fr] gap-x-4 gap-y-3 p-4 sm:grid-cols-[64px_1fr_auto]">
                <div className="relative size-16 overflow-hidden rounded-lg border border-border">
                  <ProductImage image={line.image} sizes="64px" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.title}</p>
                  <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
                  <p className="tabular mt-1 text-sm text-muted-foreground">{formatMoney(line.unitPrice)} each</p>
                </div>
                <div className="col-start-2 flex items-center justify-between gap-4 sm:col-start-3 sm:flex-col sm:items-end">
                  <div className="inline-flex items-center rounded-lg border border-border">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.title}`}
                      disabled={busy}
                      onClick={() => updateLine.mutate({ variantId: line.variantId, quantity: line.quantity - 1 })}
                      className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="tabular w-8 text-center text-sm" aria-live="polite">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.title}`}
                      disabled={busy || line.quantity >= maxQuantity}
                      onClick={() => updateLine.mutate({ variantId: line.variantId, quantity: line.quantity + 1 })}
                      className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <p className="tabular text-sm font-medium">{formatMoney(line.lineTotal)}</p>
                </div>
              </li>
            ))}
          </ul>
          {updateLine.error && <p className="mt-2 text-sm text-danger">{updateLine.error.message}</p>}
        </section>

        <section aria-labelledby="delivery-heading">
          <SectionHeading step={2}>
            <span id="delivery-heading">Delivery details</span>
          </SectionHeading>
          {addresses.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Saved addresses">
              {addresses.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-surface p-4 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                    addressId === a.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
                  )}
                >
                  <input
                    type="radio"
                    name="address"
                    className="sr-only"
                    checked={addressId === a.id}
                    onChange={() => setAddressId(a.id)}
                  />
                  <span className="font-medium">{a.fullName}</span>
                  {a.isDefault && <span className="ml-2 text-xs text-muted-foreground">Default</span>}
                  <span className="mt-1 block text-muted-foreground">{a.summary}</span>
                  <span className="tabular mt-1 block text-muted-foreground">{a.phone}</span>
                </label>
              ))}
            </div>
          )}

          {addingAddress ? (
            <div className="mt-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
              <AddressForm
                defaults={{ fullName: props.viewerName, phone: props.viewerPhone }}
                onCancel={addresses.length ? () => setAddingAddress(false) : undefined}
                onSaved={(address) => {
                  setAddressId(address.id);
                  setAddingAddress(false);
                  startRefresh(() => router.refresh());
                }}
              />
            </div>
          ) : (
            <Button variant="link" className="mt-3" onClick={() => setAddingAddress(true)}>
              Add a new address
            </Button>
          )}
        </section>

        <section aria-labelledby="method-heading">
          <SectionHeading step={3}>
            <span id="method-heading">Shipping method</span>
          </SectionHeading>
          <p className="mt-1 text-sm text-muted-foreground">Your order joins the open batch for the method you choose.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Shipping method">
            {methods.map(({ method, batchName, cutoff }) => {
              const copy = METHOD_COPY[method];
              const Icon = copy.icon;
              const available = Boolean(batchName);
              return (
                <label
                  key={method}
                  className={cn(
                    "rounded-xl border bg-surface p-4 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                    !available && "cursor-not-allowed opacity-60",
                    available && "cursor-pointer",
                    shipMethod === method ? "border-primary ring-1 ring-primary" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="shipMethod"
                    className="sr-only"
                    disabled={!available}
                    checked={shipMethod === method}
                    onChange={() => setShipMethod(method)}
                  />
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="size-4 text-info" aria-hidden />
                      {copy.label}
                    </span>
                    <span className="tabular font-medium">{copy.eta}</span>
                  </span>
                  <span className="mt-1 block text-muted-foreground">{copy.note}</span>
                  <span className="mt-3 block border-t border-border pt-3 text-xs text-muted-foreground">
                    {available ? `Joins ${batchName}, cutoff ${cutoff}` : "No batch open for this method right now"}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
          <h2 className="text-base font-semibold">Summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Items</dt>
              <dd className="tabular">{lines.reduce((n, l) => n + l.quantity, 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Product total</dt>
              <dd className="tabular font-medium">{formatMoney(productTotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="text-right text-muted-foreground">Billed after measurement</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
            <span className="font-medium">Order total today</span>
            <span className="tabular text-xl font-semibold">{formatMoney(productTotal)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Product price only. Shipping comes as a separate invoice.</p>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-warning-soft p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>I understand shipping is separate and calculated later.</span>
          </label>

          <Button size="md" className="mt-4 w-full" disabled={!canSubmit} onClick={() => placeOrder.mutate()}>
            {placeOrder.isPending ? "Placing preorder" : "Place preorder"}
          </Button>

          {placeOrder.error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {placeOrder.error.message}
            </p>
          ) : (
            blockers.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{blockers[0]}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
