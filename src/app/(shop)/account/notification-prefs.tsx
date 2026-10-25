"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ApiError } from "@/lib/api-client";

type Prefs = { whatsapp: boolean; email: boolean };

export function NotificationPrefs({ initial, hasEmail, hasPhone }: { initial: Prefs; hasEmail: boolean; hasPhone: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const save = useMutation<unknown, ApiError, Prefs>({ mutationFn: (next) => api("/api/account/notifications", { method: "PATCH", body: next }) });

  const toggle = (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    save.mutate(next, { onError: () => setPrefs(prefs) });
  };

  const rows: Array<{ key: keyof Prefs; label: string; detail: string; available: boolean }> = [
    { key: "whatsapp", label: "WhatsApp", detail: hasPhone ? "To your verified phone number" : "Add a phone number to receive WhatsApp messages", available: hasPhone },
    { key: "email", label: "Email", detail: hasEmail ? "To your email address" : "Sign in with email once to add an address", available: hasEmail },
  ];

  return (
    <div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm">
              <span className="font-medium">{row.label} reminders</span>
              <span className="block text-muted-foreground">{row.detail}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              aria-label={`${row.label} reminders`}
              disabled={!row.available || save.isPending}
              onClick={() => toggle(row.key)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${prefs[row.key] ? "bg-primary" : "bg-border"}`}
            >
              <span className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow-xs transition-transform ${prefs[row.key] ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        These switches control payment reminders only. Order confirmations, shipping invoices and shipping updates are always sent, and always appear in
        the bell.
      </p>
      {save.error && <p className="mt-2 text-sm text-danger">{save.error.message}</p>}
    </div>
  );
}
