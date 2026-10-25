import { env } from "@/lib/env";

export type SmsResult = { provider: string; messageId?: string };

export async function sendSms(to: string, text: string): Promise<SmsResult> {
  const config = env();

  switch (config.SMS_PROVIDER) {
    case "console":
      console.info(`[sms] to=${to} ${text}`);
      return { provider: "console" };

    case "termii": {
      if (!config.TERMII_API_KEY) throw new Error("TERMII_API_KEY is not set");
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.TERMII_API_KEY,
          to: to.replace(/^\+/, ""),
          from: config.TERMII_SENDER_ID,
          sms: text,
          type: "plain",
          // DND route reaches numbers on Nigeria's do-not-disturb list, which OTPs must.
          channel: "dnd",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
      if (!res.ok) throw new Error(`Termii ${res.status}: ${body.message ?? "send failed"}`);
      return { provider: "termii", messageId: body.message_id };
    }

    case "twilio": {
      const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = config;
      if (!sid || !token || !from) throw new Error("Twilio credentials are not set");
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? "send failed"}`);
      return { provider: "twilio", messageId: body.sid };
    }
  }
}
