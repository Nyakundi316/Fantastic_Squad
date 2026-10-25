"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// The code is submitted from the browser rather than on GET so that mail
// scanners prefetching the link don't burn it.
export function MagicLinkConfirm({ email, code }: { email: string; code: string }) {
  const [state, setState] = useState<"working" | "failed">("working");
  const [message, setMessage] = useState("");
  const attempted = useRef(false);

  const confirm = useCallback(async () => {
    setState("working");
    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: { message?: string } };
    if (res.ok && body.redirectTo) {
      window.location.assign(body.redirectTo);
      return;
    }
    setMessage(body.error?.message ?? "This link could not be used.");
    setState("failed");
  }, [email, code]);

  useEffect(() => {
    if (attempted.current || !email || !code) return;
    attempted.current = true;
    void confirm();
  }, [confirm, email, code]);

  if (!email || !code || state === "failed") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">This sign-in link has expired</h1>
        <p className="text-sm text-muted-foreground">{message || "The link is incomplete."} Request a new one to continue.</p>
        <Button asChild variant="secondary">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-live="polite">
      <h1 className="text-2xl font-semibold">Signing you in</h1>
      <p className="text-sm text-muted-foreground">Checking your link for {email}.</p>
    </div>
  );
}
