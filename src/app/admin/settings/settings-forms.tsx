"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

export function DivisorForm({ divisor }: { divisor: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(divisor));
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api("/api/admin/settings", { method: "PATCH", body: { volumetricDivisor: Number(value) } }),
    onSuccess: () => router.refresh(),
  });
  const error = save.error?.fields.volumetricDivisor?.[0] ?? save.error?.message;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="divisor">Volumetric divisor</Label>
        <Input id="divisor" className="tabular h-10 w-32" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />
      </div>
      <Button type="submit" variant="secondary" disabled={save.isPending || Number(value) === divisor}>
        Save
      </Button>
      <p className="basis-full text-xs text-muted-foreground">
        {error ? <span className="text-danger">{error}</span> : "Volumetric weight in grams = L × W × H in mm ÷ this number. Affects previews only; approved splits never change."}
      </p>
    </form>
  );
}

type TemplateRow = { key: string; channels: string; subject?: string; body: string; defaultSubject?: string; defaultBody: string; allowed: string[] };

export function TemplateEditor({ template }: { template: TemplateRow }) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api("/api/admin/settings", {
        method: "PATCH",
        body: { notificationTemplates: { [template.key]: { ...(template.defaultSubject ? { subject } : {}), body } } },
      }),
    onSuccess: () => router.refresh(),
  });
  const dirty = body !== template.body || (template.defaultSubject !== undefined && subject !== (template.subject ?? ""));

  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[13px]">{template.key}</span>
        <span className="text-xs text-muted-foreground">{template.channels} · in-app</span>
      </summary>
      <form
        className="space-y-3 border-t border-border px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {template.defaultSubject !== undefined && (
          <div className="space-y-1.5">
            <Label htmlFor={`${template.key}-subject`}>Email subject</Label>
            <Input id={`${template.key}-subject`} className="h-10" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${template.key}-body`}>Message</Label>
          <textarea
            id={`${template.key}-body`}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground">Placeholders: {template.allowed.map((a) => `{{${a}}}`).join("  ")}</p>
        </div>
        {save.error && <p className="text-sm text-danger">{save.error.fields[template.key]?.join(" ") ?? save.error.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            Save template
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setBody(template.defaultBody);
              setSubject(template.defaultSubject ?? "");
            }}
          >
            Restore default
          </Button>
        </div>
      </form>
    </details>
  );
}

export function RoleForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("ops");
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api("/api/admin/users/role", { body: { phone, role } }),
    onSuccess: () => {
      setPhone("");
      router.refresh();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="role-phone">Phone number</Label>
        <Input id="role-phone" className="h-10 w-48" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role-select" className="block">
          Role
        </Label>
        <select id="role-select" value={role} onChange={(e) => setRole(e.target.value)} className="h-10 rounded-lg border border-border bg-surface px-2.5 text-sm">
          {["admin", "ops", "finance", "support", "dropshipper", "customer"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={save.isPending || !phone.trim()}>
        Set role
      </Button>
      {save.error && <p className="basis-full text-sm text-danger">{save.error.fields.phone?.[0] ?? save.error.message}</p>}
    </form>
  );
}
