"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ApiError } from "@/lib/api-client";

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api("/api/account/profile", { method: "PATCH", body: { name: value } }),
    onSuccess: () => router.refresh(),
  });
  const error = save.error?.fields.name?.[0] ?? save.error?.message;

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="profile-name">Your name</Label>
        <Input id="profile-name" autoComplete="name" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error)} />
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{save.isSuccess ? "Saved." : "Used on invoices and messages."}</p>
        )}
      </div>
      <Button type="submit" variant="secondary" size="md" disabled={save.isPending || value.trim() === name} className="sm:mb-6">
        {save.isPending ? "Saving" : "Save"}
      </Button>
    </form>
  );
}
