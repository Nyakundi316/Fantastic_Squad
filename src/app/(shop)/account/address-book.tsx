"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddressForm } from "@/components/account/address-form";
import { Button } from "@/components/ui/button";

type Address = { id: string; fullName: string; phone: string; summary: string; isDefault: boolean };

export function AddressBook({ addresses, defaults }: { addresses: Address[]; defaults: { fullName: string; phone: string } }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      {addresses.length === 0 && !adding && <p className="text-sm text-muted-foreground">No saved addresses yet.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {addresses.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="font-medium">
              {a.fullName}
              {a.isDefault && <span className="ml-2 text-xs font-normal text-muted-foreground">Default</span>}
            </p>
            <p className="mt-1 text-muted-foreground">{a.summary}</p>
            <p className="tabular text-muted-foreground">{a.phone}</p>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
          <AddressForm
            defaults={defaults}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              router.refresh();
            }}
          />
        </div>
      ) : (
        <Button variant="secondary" className="mt-4" onClick={() => setAdding(true)}>
          Add address
        </Button>
      )}
    </div>
  );
}
