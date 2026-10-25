"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";
import { NIGERIAN_STATES } from "@/lib/nigeria";
import { cn } from "@/lib/utils";

type Fields = { fullName: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string };
type SavedAddress = { id: string };

function Field({ id, label, helper, error, className, ...input }: {
  id: keyof Fields;
  label: string;
  helper?: string;
  error?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={`addr-${id}`}>{label}</Label>
      <Input id={`addr-${id}`} name={id} aria-invalid={Boolean(error)} aria-describedby={`addr-${id}-hint`} {...input} />
      {error ? (
        <p id={`addr-${id}-hint`} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        helper && (
          <p id={`addr-${id}-hint`} className="text-xs text-muted-foreground">
            {helper}
          </p>
        )
      )}
    </div>
  );
}

export function AddressForm({ defaults, onSaved, onCancel }: {
  defaults?: Partial<Fields>;
  onSaved: (address: SavedAddress) => void;
  onCancel?: () => void;
}) {
  const [fields, setFields] = useState<Fields>({
    fullName: "", phone: "", line1: "", line2: "", city: "", state: "Lagos", postalCode: "", ...defaults,
  });
  const save = useMutation<{ address: SavedAddress }, ApiError>({
    mutationFn: () => api("/api/account/addresses", { body: fields }),
    onSuccess: ({ address }) => onSaved(address),
  });
  const fieldError = (key: keyof Fields) => save.error?.fields[key]?.[0];
  const bind = (key: keyof Fields) => ({
    value: fields[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [key]: e.target.value })),
    error: fieldError(key),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field id="fullName" label="Recipient name" autoComplete="name" className="sm:col-span-3" required {...bind("fullName")} />
      <Field
        id="phone"
        label="Recipient phone"
        type="tel"
        autoComplete="tel"
        helper="For the delivery rider."
        className="sm:col-span-3"
        required
        {...bind("phone")}
      />
      <Field id="line1" label="Street address" autoComplete="address-line1" className="sm:col-span-6" required {...bind("line1")} />
      <Field
        id="line2"
        label="Apartment, landmark"
        autoComplete="address-line2"
        helper="Optional"
        className="sm:col-span-6"
        {...bind("line2")}
      />
      <Field id="city" label="City or area" autoComplete="address-level2" className="sm:col-span-3" required {...bind("city")} />
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="addr-state">State</Label>
        <select
          id="addr-state"
          value={fields.state}
          onChange={(e) => setFields((f) => ({ ...f, state: e.target.value }))}
          className="h-12 w-full rounded-lg border border-border bg-surface px-3 text-base focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          {NIGERIAN_STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <Field id="postalCode" label="Postcode" inputMode="numeric" helper="Optional" className="sm:col-span-1" {...bind("postalCode")} />

      {save.error && !Object.keys(save.error.fields).length && (
        <p role="alert" className="text-sm text-danger sm:col-span-6">
          {save.error.message}
        </p>
      )}

      <div className="flex gap-3 sm:col-span-6">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving" : "Save address"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
