import { env } from "@/lib/env";

export type OutgoingEmail = { to: string; subject: string; text: string; html?: string };

export async function sendEmail(message: OutgoingEmail): Promise<{ provider: string; messageId?: string }> {
  const config = env();

  if (config.EMAIL_PROVIDER === "console") {
    console.info(`[email] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return { provider: "console" };
  }

  if (!config.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? "send failed"}`);
  return { provider: "resend", messageId: body.id };
}
