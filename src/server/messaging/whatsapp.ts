import { env } from "@/lib/env";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * WhatsApp Cloud API. Business-initiated messages must use a Meta-approved
 * template; we send the template named after our key with the body parameters
 * in placeholder order. "text" mode sends the rendered body (24h window only).
 */
export async function sendWhatsApp(to: string, message: { template: string; body: string; params: string[] }) {
  const config = env();

  if (config.WHATSAPP_PROVIDER === "console") {
    console.info(`[whatsapp] to=${to} template=${message.template} ${message.body}`);
    return { provider: "console" };
  }

  if (!config.WHATSAPP_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp Cloud API credentials are not set");
  const payload =
    config.WHATSAPP_MODE === "template"
      ? {
          messaging_product: "whatsapp",
          to: to.replace(/^\+/, ""),
          type: "template",
          template: {
            name: message.template,
            language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE },
            components: [{ type: "body", parameters: message.params.map((text) => ({ type: "text", text: text || "-" })) }],
          },
        }
      : { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: message.body, preview_url: true } };

  const res = await fetch(`${GRAPH}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${body.error?.message ?? "send failed"}`);
  return { provider: "whatsapp_cloud", messageId: body.messages?.[0]?.id };
}
