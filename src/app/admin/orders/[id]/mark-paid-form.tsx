"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

export function MarkPaidForm({ invoiceId, amountLabel }: { invoiceId: string; amountLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"bank_transfer" | "manual">("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const markPaid = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api(`/api/admin/invoices/${invoiceId}/mark-paid`, {
        body: { method, reference: reference || undefined, note: note || undefined },
      }),
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Mark paid
      </Button>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        markPaid.mutate();
      }}
    >
      <p className="text-sm">
        Record a payment of <span className="tabular font-semibold">{amountLabel}</span>. This cannot be undone here.
      </p>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Payment method</legend>
        {(["bank_transfer", "manual"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} className="accent-primary" />
            {m === "bank_transfer" ? "Bank transfer" : "Other (cash, POS)"}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`ref-${invoiceId}`}>Reference</Label>
          <Input id={`ref-${invoiceId}`} className="h-10" value={reference} onChange={(e) => setReference(e.target.value)} />
          <p className="text-xs text-muted-foreground">Bank narration or receipt number.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`note-${invoiceId}`}>Note</Label>
          <Input id={`note-${invoiceId}`} className="h-10" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {markPaid.error && <p className="text-sm text-danger">{markPaid.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={markPaid.isPending}>
          {markPaid.isPending ? "Recording" : "Confirm payment"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
