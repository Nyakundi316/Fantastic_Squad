"use client";

import { useMutation } from "@tanstack/react-query";
import { Anchor, Info, Minus, Plane, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Variant = { id: string; label: string; price: string };
type MethodOption = { method: "sea" | "air"; batchName: string | null; closes: string | null };

const METHOD_COPY = {
  sea: { label: "Sea", eta: "30–45 days", note: "Lower cost per kg", icon: Anchor },
  air: { label: "Air", eta: "7–14 days", note: "Faster, costlier per kg", icon: Plane },
} as const;

export function PurchasePanel({ variants, methods, maxQuantity }: { variants: Variant[]; methods: MethodOption[]; maxQuantity: number }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]!.id);
  const [quantity, setQuantity] = useState(1);
  const variant = variants.find((v) => v.id === variantId)!;
  const anyBatchOpen = methods.some((m) => m.batchName);

  const join = useMutation<unknown, ApiError>({
    mutationFn: () => api("/api/cart", { body: { variantId, quantity } }),
    onSuccess: () => router.push("/checkout"),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="tabular text-3xl font-semibold">{formatMoney(variant.price)}</p>
        <p className="mt-1 text-sm text-muted-foreground">Product price only, per item.</p>
      </div>

      {variants.length > 1 && (
        <fieldset>
          <legend className="text-sm font-medium">Option</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {variants.map((v) => (
              <label
                key={v.id}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                  v.id === variantId ? "border-primary bg-primary/5 font-medium text-primary" : "border-border bg-surface hover:border-foreground/30",
                )}
              >
                <input type="radio" name="variant" value={v.id} checked={v.id === variantId} onChange={() => setVariantId(v.id)} className="sr-only" />
                {v.label}
                {v.price !== variants[0]!.price && <span className="ml-1.5 text-xs text-muted-foreground">{formatMoney(v.price)}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <p className="text-sm font-medium" id="qty-label">
          Quantity
        </p>
        <div className="mt-2 inline-flex items-center rounded-lg border border-border bg-surface" role="group" aria-labelledby="qty-label">
          <button
            type="button"
            className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus className="size-4" />
          </button>
          <input
            className="tabular h-10 w-12 border-x border-border bg-transparent text-center text-base"
            inputMode="numeric"
            aria-label="Quantity"
            value={quantity}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ""));
              setQuantity(Math.min(maxQuantity, Math.max(1, n || 1)));
            }}
          />
          <button
            type="button"
            className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
            disabled={quantity >= maxQuantity}
            aria-label="Increase quantity"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-info/20 bg-info-soft p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Info className="size-4 text-info" aria-hidden />
          Shipping is separate and billed later
        </p>
        <p className="mt-1.5 text-foreground/80">
          Your items are weighed in China, then the batch shipping quote is split across orders by weight. You will see your
          share, and exactly how it was worked out, before you pay it. There is no shipping figure until then.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {methods.map(({ method, batchName, closes }) => {
          const copy = METHOD_COPY[method];
          const Icon = copy.icon;
          return (
            <div key={method} className={cn("rounded-xl border border-border bg-surface p-3.5", !batchName && "opacity-60")}>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="size-4 text-info" aria-hidden />
                {copy.label}
              </p>
              <p className="mt-2 text-lg font-semibold">{copy.eta}</p>
              <p className="text-xs text-muted-foreground">{copy.note}</p>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {batchName ? `${batchName} · closes ${closes}` : "No batch open right now"}
              </p>
            </div>
          );
        })}
      </div>

      <div>
        <Button size="md" className="w-full" disabled={!anyBatchOpen || join.isPending} onClick={() => join.mutate()}>
          {join.isPending ? "Adding" : anyBatchOpen ? "Join this preorder" : "No batch open"}
        </Button>
        {join.error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {join.error.message}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">You choose sea or air at checkout.</p>
      </div>
    </div>
  );
}
