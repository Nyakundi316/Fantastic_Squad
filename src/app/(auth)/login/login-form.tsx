"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Channel = "phone" | "email";
type ApiError = { error?: { code?: string; message?: string; details?: { fields?: Record<string, string[]> } } };

const RESEND_COOLDOWN_SECONDS = 30;

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string; field?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & ApiError;
  if (res.ok) return { ok: true, data: json };
  const fields = json.error?.details?.fields;
  const [field, messages] = Object.entries(fields ?? {})[0] ?? [];
  return { ok: false, message: messages?.[0] ?? json.error?.message ?? "Something went wrong. Try again.", field };
}

export function LoginForm({ next }: { next?: string }) {
  const [channel, setChannel] = useState<Channel>("phone");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"contact" | "code">("contact");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function requestCode() {
    setPending(true);
    setError(null);
    const result = await postJson("/api/auth/otp/request", { [channel]: contact });
    setPending(false);
    if (!result.ok) return setError(result.message);
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function verifyCode() {
    setPending(true);
    setError(null);
    const result = await postJson<{ redirectTo: string }>("/api/auth/otp/verify", { [channel]: contact, code, next });
    if (!result.ok) {
      setPending(false);
      return setError(result.message);
    }
    // Full navigation: a client refresh here would re-request /login, which bounces signed-in users to their home.
    window.location.assign(result.data.redirectTo);
  }

  const errorId = error ? "login-error" : undefined;

  if (step === "code") {
    return (
      <form
        key="code"
        className="mt-8 animate-slide-in-up space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void verifyCode();
        }}
      >
        <p className="text-sm">
          {channel === "phone" ? "We sent a 6-digit code to " : "We sent a sign-in link and code to "}
          <span className="font-medium">{contact}</span>.{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setStep("contact");
              setError(null);
            }}
          >
            Change
          </button>
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="otp-code">Code</Label>
          <Input
            id="otp-code"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-invalid={Boolean(error)}
            aria-describedby={errorId ?? "otp-help"}
            className="tabular text-lg tracking-[0.4em]"
          />
          {error ? (
            <p id="login-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : (
            <p id="otp-help" className="text-xs text-muted-foreground">
              Use the most recent code. It expires in 10 minutes.
            </p>
          )}
        </div>

        <Button type="submit" size="md" className="w-full" disabled={pending || code.length !== 6}>
          {pending ? "Checking" : "Continue"}
        </Button>

        <p className="text-sm text-muted-foreground">
          {cooldown > 0 ? (
            <span className="tabular">You can request another code in {cooldown}s.</span>
          ) : (
            <button type="button" className="text-primary hover:underline" disabled={pending} onClick={() => void requestCode()}>
              Send a new code
            </button>
          )}
        </p>
      </form>
    );
  }

  return (
    <form
      key="contact"
      className="mt-8 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void requestCode();
      }}
    >
      <div role="tablist" aria-label="Sign in with" className="inline-flex rounded-lg bg-muted p-1 text-sm">
        {(["phone", "email"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={channel === option}
            onClick={() => {
              setChannel(option);
              setContact("");
              setError(null);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              channel === option ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option === "phone" ? "Phone" : "Email"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact">{channel === "phone" ? "Phone number" : "Email address"}</Label>
        <Input
          id="contact"
          type={channel === "phone" ? "tel" : "email"}
          inputMode={channel === "phone" ? "tel" : "email"}
          autoComplete={channel === "phone" ? "tel" : "email"}
          placeholder={channel === "phone" ? "0803 000 0000" : "you@example.com"}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId ?? "contact-help"}
          required
        />
        {error ? (
          <p id="login-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : (
          <p id="contact-help" className="text-xs text-muted-foreground">
            {channel === "phone"
              ? "Nigerian numbers can start with 0. Other countries need the + code."
              : "We will email a sign-in link and a code."}
          </p>
        )}
      </div>

      <Button type="submit" size="md" className="w-full" disabled={pending || !contact.trim()}>
        {pending ? "Sending" : channel === "phone" ? "Send code" : "Email me a link"}
      </Button>
    </form>
  );
}
