"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ALLOCATION_METHOD_LABELS } from "@/lib/allocation-methods";
import { api, type ApiError } from "@/lib/api-client";

type Method = "weight" | "volumetric" | "quantity" | "equal";

export function QuoteForm({ batchId, quote, method }: { batchId: string; quote: string | null; method: Method | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(quote ?? "");
  const [allocation, setAllocation] = useState<Method>(method ?? "weight");

  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api(`/api/admin/batches/${batchId}`, {
        method: "PATCH",
        body: { shippingQuote: amount.replace(/,/g, "").trim(), allocationMethod: allocation },
      }),
    onSuccess: () => router.refresh(),
  });
  const error = save.error?.fields.shippingQuote?.[0] ?? save.error?.message;

  return (
    <form
      className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="quote">Batch shipping quote (₦)</Label>
        <Input
          id="quote"
          className="tabular h-10"
          inputMode="decimal"
          placeholder="1250000.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={Boolean(error)}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : <p className="text-xs text-muted-foreground">Total from the freight forwarder.</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="allocation-method">Split method</Label>
        <select
          id="allocation-method"
          value={allocation}
          onChange={(e) => setAllocation(e.target.value as Method)}
          className="h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm"
        >
          {(Object.keys(ALLOCATION_METHOD_LABELS) as Method[]).map((m) => (
            <option key={m} value={m}>
              {ALLOCATION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" className="sm:mt-[26px]" disabled={save.isPending || !amount.trim()}>
        {save.isPending ? "Saving" : "Save quote"}
      </Button>
    </form>
  );
}
