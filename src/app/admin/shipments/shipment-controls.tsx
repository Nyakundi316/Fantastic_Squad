"use client";

import { useMutation } from "@tanstack/react-query";
import type { ShipmentStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

type Details = { carrier: string; trackingNumber: string; estimatedDays: string };

function DetailsFields({ value, onChange, idPrefix }: { value: Details; onChange: (d: Details) => void; idPrefix: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-carrier`}>Carrier</Label>
        <Input id={`${idPrefix}-carrier`} className="h-10" value={value.carrier} onChange={(e) => onChange({ ...value, carrier: e.target.value })} placeholder="e.g. Maersk / DHL" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-tracking`}>Tracking number</Label>
        <Input id={`${idPrefix}-tracking`} className="h-10" value={value.trackingNumber} onChange={(e) => onChange({ ...value, trackingNumber: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-eta`}>ETA (days)</Label>
        <Input id={`${idPrefix}-eta`} className="h-10" inputMode="numeric" value={value.estimatedDays} onChange={(e) => onChange({ ...value, estimatedDays: e.target.value.replace(/\D/g, "") })} />
      </div>
    </div>
  );
}

const toBody = (d: Details) => ({
  carrier: d.carrier.trim() || null,
  trackingNumber: d.trackingNumber.trim() || null,
  estimatedDays: d.estimatedDays ? Number(d.estimatedDays) : null,
});

export function CreateShipmentForm({ batchId, defaultEta }: { batchId: string; defaultEta: number }) {
  const router = useRouter();
  const [details, setDetails] = useState<Details>({ carrier: "", trackingNumber: "", estimatedDays: String(defaultEta) });
  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api("/api/admin/shipments", { body: { batchId, ...toBody(details) } }),
    onSuccess: () => router.refresh(),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <DetailsFields value={details} onChange={setDetails} idPrefix={`new-${batchId}`} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Booking" : "Book shipment"}
        </Button>
        {create.error && <span className="text-sm text-danger">{create.error.message}</span>}
      </div>
    </form>
  );
}

const STEP: Partial<Record<ShipmentStatus, { to: ShipmentStatus; label: string }>> = {
  pending: { to: "in_transit", label: "Mark dispatched" },
  in_transit: { to: "arrived", label: "Mark arrived" },
  arrived: { to: "delivered", label: "Mark delivered" },
};

export function ShipmentStepButton({ shipmentId, status, warning }: { shipmentId: string; status: ShipmentStatus; warning?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const step = STEP[status];
  const advance = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/shipments/${shipmentId}`, { method: "PATCH", body: { status: step!.to } }),
    onSuccess: () => {
      setConfirming(false);
      router.refresh();
    },
  });
  if (!step) return null;

  return (
    <div className="space-y-2">
      {confirming && warning ? (
        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          <p>{warning}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate()}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" disabled={advance.isPending} onClick={() => (warning ? setConfirming(true) : advance.mutate())}>
          {step.label}
        </Button>
      )}
      {advance.error && <p className="text-sm text-danger">{advance.error.message}</p>}
    </div>
  );
}

export function EditShipmentDetails({ shipmentId, initial }: { shipmentId: string; initial: Details }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(initial);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/shipments/${shipmentId}`, { method: "PATCH", body: toBody(details) }),
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      <DetailsFields value={details} onChange={setDetails} idPrefix={shipmentId} />
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {save.error && <span className="text-sm text-danger">{save.error.message}</span>}
      </div>
    </div>
  );
}

export function ReleaseOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const release = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/api/admin/orders/${orderId}/deliver`, { method: "POST" }),
    onSuccess: () => router.refresh(),
  });
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={release.isPending} onClick={() => release.mutate()}>
        Mark delivered
      </Button>
      {release.error && <span className="text-xs text-danger">{release.error.message}</span>}
    </span>
  );
}
