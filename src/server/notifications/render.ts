import type { Prisma } from "@prisma/client";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, isTemplateKey, placeholders, type NotificationTemplate, type TemplateKey } from "./templates";

type Overrides = Partial<Record<TemplateKey, { subject?: string; body?: string }>>;

/** Defaults with any admin edits from settings.notification_templates applied. Channels are fixed. */
export function effectiveTemplates(stored: Prisma.JsonValue | null | undefined): Record<TemplateKey, NotificationTemplate> {
  const overrides = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Overrides;
  return Object.fromEntries(
    TEMPLATE_KEYS.map((key) => {
      const base: NotificationTemplate = DEFAULT_TEMPLATES[key];
      const edit = overrides[key];
      return [
        key,
        {
          channels: base.channels,
          subject: typeof edit?.subject === "string" && edit.subject.trim() ? edit.subject : base.subject,
          body: typeof edit?.body === "string" && edit.body.trim() ? edit.body : base.body,
        },
      ];
    }),
  ) as Record<TemplateKey, NotificationTemplate>;
}

export function fill(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => (vars[name] === undefined || vars[name] === null ? "" : String(vars[name])));
}

export function renderNotification(template: string, payload: Prisma.JsonValue, templates: Record<TemplateKey, NotificationTemplate>) {
  const vars = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  if (!isTemplateKey(template)) return { subject: undefined, body: "", params: [] as string[] };
  const t = templates[template];
  return {
    subject: t.subject ? fill(t.subject, vars) : undefined,
    body: fill(t.body, vars),
    // WhatsApp template parameters, in the order the placeholders appear in the body.
    params: placeholders(t.body).map((name) => (vars[name] === undefined ? "" : String(vars[name]))),
  };
}
