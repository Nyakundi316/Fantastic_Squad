"use client";

import { useMutation } from "@tanstack/react-query";
import type { BatchStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";

type Props = {
  batchId: string;
  status: BatchStatus;
  canManage: boolean;
  canMeasure: boolean;
  allMeasured: boolean;
  unmeasured: number;
  closePreview: { confirm: string[]; cancel: string[] };
};

export function BatchActions({ batchId, status, canManage, canMeasure, allMeasured, unmeasured, closePreview }: Props) {
  const router = useRouter();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const transition = useMutation<unknown, ApiError, BatchStatus>({
    mutationFn: (to) => api(`/api/admin/batches/${batchId}`, { method: "PATCH", body: { status: to } }),
    onSuccess: () => {
      setConfirmingClose(false);
      router.refresh();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "collecting" && canManage && !confirmingClose && (
          <Button onClick={() => setConfirmingClose(true)}>Close batch and order</Button>
        )}
        {(status === "ordered" || status === "measured") && canMeasure && (
          <Button asChild variant={status === "ordered" ? "primary" : "secondary"}>
            <Link href={`/admin/batches/${batchId}/measurements`}>{status === "ordered" ? "Enter measurements" : "Edit measurements"}</Link>
          </Button>
        )}
        {status === "ordered" && canManage && (
          <Button variant="secondary" disabled={!allMeasured || transition.isPending} onClick={() => transition.mutate("measured")}>
            Mark as measured
          </Button>
        )}
        {status === "measured" && (
          <Button asChild>
            <Link href={`/admin/batches/${batchId}/allocation`}>Preview allocation</Link>
          </Button>
        )}
      </div>

      {status === "ordered" && !allMeasured && (
        <p className="text-sm text-muted-foreground">
          {unmeasured} {unmeasured === 1 ? "item needs" : "items need"} a measurement before this batch can be marked measured.
        </p>
      )}

      {confirmingClose && (
        <div className="max-w-xl rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="font-medium">Close this batch?</p>
          <ul className="mt-2 space-y-1">
            <li>
              <span className="tabular font-medium">{closePreview.confirm.length}</span> paid{" "}
              {closePreview.confirm.length === 1 ? "order is" : "orders are"} confirmed and customers are told on WhatsApp.
            </li>
            <li className={closePreview.cancel.length ? "text-danger" : "text-muted-foreground"}>
              <span className="tabular font-medium">{closePreview.cancel.length}</span> unpaid{" "}
              {closePreview.cancel.length === 1 ? "order is" : "orders are"} cancelled and their invoices voided
              {closePreview.cancel.length > 0 && `: ${closePreview.cancel.join(", ")}`}.
            </li>
          </ul>
          <p className="mt-2 text-muted-foreground">No new orders can join afterwards. This can&rsquo;t be undone.</p>
          <div className="mt-4 flex gap-2">
            <Button disabled={transition.isPending} onClick={() => transition.mutate("ordered")}>
              {transition.isPending ? "Closing" : "Confirm and close"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingClose(false)}>
              Keep collecting
            </Button>
          </div>
        </div>
      )}

      {transition.error && (
        <p role="alert" className="text-sm text-danger">
          {transition.error.message}
        </p>
      )}
    </div>
  );
}
