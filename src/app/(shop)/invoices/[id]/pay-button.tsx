"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { api, type ApiError } from "@/lib/api-client";

export function PayButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const pay = useMutation<{ checkoutUrl: string }, ApiError>({
    mutationFn: () => api("/api/payments/initiate", { body: { invoiceId, provider: "paystack" } }),
    onSuccess: ({ checkoutUrl }) => {
      track("payment_started", { invoiceId, provider: "paystack" });
      window.location.assign(checkoutUrl);
    },
  });

  return (
    <div>
      <Button size="md" className="w-full sm:w-auto" disabled={pay.isPending || pay.isSuccess} onClick={() => pay.mutate()}>
        {pay.isPending || pay.isSuccess ? "Opening Paystack" : label}
      </Button>
      {pay.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {pay.error.message}
        </p>
      )}
    </div>
  );
}
