import { describe, expect, it } from "vitest";
import { effectiveTemplates, fill, renderNotification } from "@/server/notifications/render";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, allowedPlaceholders, placeholders } from "@/server/notifications/templates";

describe("notification templates", () => {
  it("has the seven templates from the spec, on the right channels", () => {
    expect(TEMPLATE_KEYS).toEqual([
      "order_received", "batch_closed", "shipping_invoice_ready", "shipping_invoice_reminder", "shipping_paid", "shipment_dispatched", "shipment_delivered",
    ]);
    expect(DEFAULT_TEMPLATES.order_received.channels).toEqual(["whatsapp", "email"]);
    expect(DEFAULT_TEMPLATES.shipping_invoice_reminder.channels).toEqual(["whatsapp"]);
    expect(DEFAULT_TEMPLATES.shipment_dispatched.channels).toEqual(["whatsapp", "email"]);
  });

  it("keeps money and shipping copy free of emoji and exclamation marks (rule 8)", () => {
    for (const key of TEMPLATE_KEYS) {
      const t = DEFAULT_TEMPLATES[key] as { subject?: string; body: string };
      const text = `${t.subject ?? ""} ${t.body}`;
      expect(text, key).not.toMatch(/!/);
      expect(text, key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("fills placeholders and blanks unknown ones", () => {
    expect(fill("Hi {{name}}, {{missing}}order {{orderNumber}}", { name: "Ada", orderNumber: "FZ-1001" })).toBe("Hi Ada, order FZ-1001");
    expect(placeholders("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
    expect(allowedPlaceholders("shipping_invoice_ready")).toEqual(["orderNumber", "name", "shipMethod", "amount", "dueDate", "invoiceUrl"]);
  });

  it("applies admin edits but keeps channels fixed, and returns WhatsApp params in body order", () => {
    const templates = effectiveTemplates({ shipping_paid: { body: "{{orderNumber}} paid by {{name}}: {{amount}}" }, bogus: { body: "x" } });
    expect(templates.shipping_paid.channels).toEqual(["whatsapp"]);
    const rendered = renderNotification("shipping_paid", { name: "Ada", orderNumber: "FZ-1", amount: "₦5.00" }, templates);
    expect(rendered.body).toBe("FZ-1 paid by Ada: ₦5.00");
    expect(rendered.params).toEqual(["FZ-1", "Ada", "₦5.00"]);
    expect(effectiveTemplates(null).order_received.subject).toBe("We have your order {{orderNumber}}");
    expect(renderNotification("unknown", {}, templates).body).toBe("");
  });
});
