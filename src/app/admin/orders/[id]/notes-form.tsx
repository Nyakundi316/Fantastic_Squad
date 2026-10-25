"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";

export function NotesForm({ orderId, notes }: { orderId: string; notes: string }) {
  const router = useRouter();
  const [value, setValue] = useState(notes);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/orders/${orderId}/notes`, { method: "PATCH", body: { notes: value } }),
    onSuccess: () => router.refresh(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="internal-notes" className="sr-only">
        Internal notes
      </label>
      <textarea
        id="internal-notes"
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Visible to staff only."
        className="w-full rounded-lg border border-border bg-surface p-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" variant="secondary" disabled={save.isPending || value === notes}>
          {save.isPending ? "Saving" : "Save note"}
        </Button>
        {save.error && <span className="text-sm text-danger">{save.error.message}</span>}
      </div>
    </form>
  );
}
