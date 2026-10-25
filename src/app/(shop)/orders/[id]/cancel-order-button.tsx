"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";

export function CancelOrderButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/orders/${orderId}/cancel`, { method: "POST" }),
    onSuccess: () => router.refresh(),
  });

  if (!confirming) {
    return (
      <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(true)}>
        Cancel preorder
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <p>Cancel {orderNumber}? The product invoice will be voided.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          {cancel.isPending ? "Cancelling" : "Yes, cancel"}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Keep order
        </Button>
      </div>
      {cancel.error && <p className="mt-2 text-danger">{cancel.error.message}</p>}
    </div>
  );
}
