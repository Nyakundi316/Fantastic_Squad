// Defaults copied into settings.notification_templates by the seed; admins edit them in /admin/settings.
// Placeholders use {{var}}. No emoji or exclamation marks: these are money and shipping messages.

export type TemplateChannel = "whatsapp" | "email";

export type NotificationTemplate = {
  channels: readonly TemplateChannel[];
  subject?: string;
  body: string;
};

export const DEFAULT_TEMPLATES = {
  order_received: {
    channels: ["whatsapp", "email"],
    subject: "We have your order {{orderNumber}}",
    body: "Hi {{name}}, thanks for your order {{orderNumber}}. Your product payment of {{amount}} is confirmed. Shipping is separate and will be invoiced once your batch is measured in China.",
  },
  batch_closed: {
    channels: ["whatsapp"],
    body: "Hi {{name}}, the {{batchName}} batch has closed and order {{orderNumber}} is now with our supplier. We will message you again once your items are measured.",
  },
  shipping_invoice_ready: {
    channels: ["whatsapp", "email"],
    subject: "Shipping invoice for {{orderNumber}}",
    body: "Hi {{name}}, your items for {{orderNumber}} have been measured. Your share of the {{shipMethod}} shipping is {{amount}}, due by {{dueDate}}. See how it was calculated and pay here: {{invoiceUrl}}",
  },
  shipping_invoice_reminder: {
    channels: ["whatsapp"],
    body: "Hi {{name}}, a reminder that the shipping invoice for {{orderNumber}} ({{amount}}) is due on {{dueDate}}. You can pay here: {{invoiceUrl}}",
  },
  shipping_paid: {
    channels: ["whatsapp"],
    body: "Hi {{name}}, we have received your shipping payment of {{amount}} for {{orderNumber}}. We will let you know when the batch ships.",
  },
  shipment_dispatched: {
    channels: ["whatsapp", "email"],
    subject: "{{orderNumber}} has shipped",
    body: "Hi {{name}}, order {{orderNumber}} has left China by {{shipMethod}}. Estimated arrival is in {{estimatedDays}} days. Tracking number: {{trackingNumber}}.",
  },
  shipment_delivered: {
    channels: ["whatsapp"],
    body: "Hi {{name}}, order {{orderNumber}} has been delivered. Thank you for shopping with FANTASTICZONE.",
  },
} as const satisfies Record<string, NotificationTemplate>;

export type TemplateKey = keyof typeof DEFAULT_TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES) as TemplateKey[];

/** Short headings for the in-app bell. */
export const TEMPLATE_TITLES: Record<TemplateKey, string> = {
  order_received: "Order confirmed",
  batch_closed: "Batch closed",
  shipping_invoice_ready: "Shipping invoice ready",
  shipping_invoice_reminder: "Shipping payment due soon",
  shipping_paid: "Shipping paid",
  shipment_dispatched: "Order shipped",
  shipment_delivered: "Order delivered",
};

/**
 * Essential messages always go out on every channel. Only reminders respect a
 * customer's channel preferences (approved behaviour for notification_prefs).
 */
export const OPTIONAL_TEMPLATES: ReadonlySet<TemplateKey> = new Set(["shipping_invoice_reminder"]);

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];
}

/** Placeholders a template may use: whatever its default uses. */
export function allowedPlaceholders(key: TemplateKey): string[] {
  const t: NotificationTemplate = DEFAULT_TEMPLATES[key];
  return placeholders(`${t.subject ?? ""} ${t.body}`);
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && value in DEFAULT_TEMPLATES;
}
