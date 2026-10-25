"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api-client";

export type InvoiceRow = {
  id: string;
  label: string;
  orderId: string;
  orderNumber: string;
  customer: string;
  amount: string;
  status: { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" | "accent" };
  issued: string;
  due: string;
  resendable: boolean;
};

export function InvoiceTable({ rows, canResend }: { rows: InvoiceRow[]; canResend: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const resendable = rows.filter((r) => r.resendable);
  const resend = useMutation<{ sent: number; skipped: number }, ApiError>({
    mutationFn: () => api("/api/admin/invoices/resend", { body: { invoiceIds: [...selected] } }),
    onSuccess: () => {
      setSelected(new Set());
      router.refresh();
    },
  });
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      {canResend && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={selected.size === 0 || resend.isPending} onClick={() => resend.mutate()}>
            {resend.isPending ? "Resending" : selected.size ? `Resend ${selected.size} ${selected.size === 1 ? "invoice" : "invoices"}` : "Resend selected"}
          </Button>
          <span className="text-muted-foreground">Unpaid shipping invoices only. Customers get the invoice message again on WhatsApp and email.</span>
          {resend.data && <span className="text-success">Queued {resend.data.sent}.</span>}
          {resend.error && <span className="text-danger">{resend.error.message}</span>}
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_rgb(var(--border))]">
            <tr>
              {canResend && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all resendable invoices"
                    className="accent-primary"
                    checked={resendable.length > 0 && resendable.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(resendable.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Issued</th>
              <th className="px-4 py-3 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/60">
                {canResend && (
                  <td className="px-4 py-3">
                    {row.resendable && (
                      <input type="checkbox" aria-label={`Select ${row.orderNumber}`} className="accent-primary" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <a href={`/admin/orders/${row.orderId}`} className="tabular font-medium text-primary hover:underline">
                    {row.orderNumber}
                  </a>
                  <span className="ml-2 text-muted-foreground">{row.label}</span>
                </td>
                <td className="px-4 py-3">{row.customer}</td>
                <td className="px-4 py-3">
                  <Badge tone={row.status.tone}>{row.status.label}</Badge>
                </td>
                <td className="tabular px-4 py-3 text-right font-medium">{row.amount}</td>
                <td className="tabular px-4 py-3 text-right text-muted-foreground">{row.issued}</td>
                <td className="tabular px-4 py-3 text-right text-muted-foreground">{row.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No invoices match.</p>}
      </div>
    </div>
  );
}
