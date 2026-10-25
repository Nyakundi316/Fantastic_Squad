"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";

export function ApproveButton({ batchId, fingerprint, orderCount, totalLabel }: { batchId: string; fingerprint: string; orderCount: number; totalLabel: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const approve = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/batches/${batchId}/allocation/approve`, { body: { fingerprint } }),
    onSuccess: () => router.refresh(),
  });

  if (!confirming) {
    return (
      <Button size="md" onClick={() => setConfirming(true)}>
        Approve and send invoices
      </Button>
    );
  }

  return (
    <div className="max-w-md rounded-xl border border-border bg-surface p-4 text-sm shadow-pop">
      <p className="font-medium">
        Send {orderCount} shipping {orderCount === 1 ? "invoice" : "invoices"} totalling {totalLabel}?
      </p>
      <p className="mt-1 text-muted-foreground">Approved allocations and invoices can&rsquo;t be edited afterwards. Corrections are issued as new invoice versions.</p>
      <div className="mt-4 flex gap-2">
        <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
          {approve.isPending ? "Approving" : "Yes, approve and send"}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Back
        </Button>
      </div>
      {approve.error && (
        <p role="alert" className="mt-3 text-danger">
          {approve.error.message}
        </p>
      )}
    </div>
  );
}
