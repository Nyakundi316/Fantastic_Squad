"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

export function NewBatchForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cutoff, setCutoff] = useState("");
  const [method, setMethod] = useState<"sea" | "air">("sea");

  const create = useMutation<{ batch: { id: string } }, ApiError>({
    mutationFn: () =>
      api("/api/admin/batches", { body: { name, cutoffAt: cutoff ? new Date(cutoff).toISOString() : "", defaultShipMethod: method } }),
    onSuccess: ({ batch }) => router.push(`/admin/batches/${batch.id}`),
  });

  if (!open) return <Button onClick={() => setOpen(true)}>New batch</Button>;

  return (
    <form
      className="w-full rounded-xl border border-border bg-surface p-5 sm:max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <p className="font-semibold">New batch</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="batch-name">Name</Label>
          <Input id="batch-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="December Air Batch" />
          {create.error?.fields.name && <p className="text-sm text-danger">{create.error.fields.name[0]}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="batch-cutoff">Cutoff</Label>
          <Input id="batch-cutoff" className="h-10" type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          {create.error?.fields.cutoffAt ? (
            <p className="text-sm text-danger">{create.error.fields.cutoffAt[0]}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Orders stop joining at this time.</p>
          )}
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Ship method</legend>
          <div className="flex h-10 items-center gap-4 text-sm">
            {(["sea", "air"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} className="accent-primary" />
                {m === "sea" ? "Sea" : "Air"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {create.error && !Object.keys(create.error.fields).length && <p className="mt-3 text-sm text-danger">{create.error.message}</p>}
      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating" : "Create batch"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
