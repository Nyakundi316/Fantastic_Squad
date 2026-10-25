"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

export function AdjustInvoiceForm({ invoiceId, currentAmount }: { invoiceId: string; currentAmount: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(currentAmount);
  const [reason, setReason] = useState("");
  const adjust = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/invoices/${invoiceId}/adjust`, { body: { amount: amount.replace(/,/g, "").trim(), reason } }),
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Adjust
      </Button>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        adjust.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Issues a new version of this invoice. The current one is kept and marked replaced; the customer is sent the new amount.
      </p>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`adj-amount-${invoiceId}`}>New amount (₦)</Label>
          <Input id={`adj-amount-${invoiceId}`} className="tabular h-10" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {adjust.error?.fields.amount && <p className="text-sm text-danger">{adjust.error.fields.amount[0]}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`adj-reason-${invoiceId}`}>Reason</Label>
          <Input id={`adj-reason-${invoiceId}`} className="h-10" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown to the customer" />
          {adjust.error?.fields.reason && <p className="text-sm text-danger">{adjust.error.fields.reason[0]}</p>}
        </div>
      </div>
      {adjust.error && !Object.keys(adjust.error.fields).length && <p className="text-sm text-danger">{adjust.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={adjust.isPending}>
          {adjust.isPending ? "Issuing" : "Issue new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
