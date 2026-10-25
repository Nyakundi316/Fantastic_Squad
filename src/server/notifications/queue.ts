import type { Prisma } from "@prisma/client";
import { DEFAULT_TEMPLATES, type TemplateKey } from "./templates";

type TemplateVars = Record<string, string | number>;

/**
 * Queues one row per channel the template uses, plus an in-app copy for the bell.
 * Rows are written inside the caller's transaction so a rolled-back change sends nothing.
 * `link` is where the in-app notification points (e.g. /invoices/:id).
 */
export async function queueNotification(
  tx: Prisma.TransactionClient,
  { userId, template, vars, link }: { userId: string; template: TemplateKey; vars: TemplateVars; link?: string },
) {
  const channels = [...DEFAULT_TEMPLATES[template].channels, "in_app" as const];
  const payload = { ...vars, ...(link ? { link } : {}) };
  await tx.notification.createMany({
    data: channels.map((channel) => ({ userId, channel, template, payload })),
  });
}
