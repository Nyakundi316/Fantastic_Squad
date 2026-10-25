"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-NG">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 24px", color: "#0F1117", background: "#F7F7F9" }}>
        <p style={{ fontWeight: 700 }}>FANTASTICZONE</p>
        <h1 style={{ fontSize: 24, marginTop: 48 }}>Something went wrong on our side</h1>
        <p style={{ color: "#5A6072", maxWidth: 420 }}>
          Nothing was charged twice and your orders are safe. Try again, and if it keeps happening contact support with this reference: {error.digest ?? "n/a"}.
        </p>
        <button onClick={reset} style={{ marginTop: 16, height: 40, padding: "0 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
