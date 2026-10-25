import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { writeAudit } from "@/server/audit";
import { HttpError, readJson, route } from "@/server/http";
import { TEMPLATE_KEYS, allowedPlaceholders, placeholders, type TemplateKey } from "@/server/notifications/templates";
import { getSettings } from "@/server/settings";

const templateEdit = z.object({ subject: z.string().max(200).optional(), body: z.string().trim().min(10).max(1000) });

const bodySchema = z
  .object({
    volumetricDivisor: z.number().int().min(1000).max(10_000).optional(),
    notificationTemplates: z.record(z.string(), templateEdit).optional(),
  })
  .refine((b) => b.volumetricDivisor !== undefined || b.notificationTemplates !== undefined, { message: "Nothing to update." });

export const PATCH = route(async (req) => {
  const actor = await requireApiUser(req, "settings.write");
  const input = await readJson(req, bodySchema);

  if (input.notificationTemplates) {
    const problems: Record<string, string[]> = {};
    for (const [key, edit] of Object.entries(input.notificationTemplates)) {
      if (!TEMPLATE_KEYS.includes(key as TemplateKey)) {
        problems[key] = ["Unknown template."];
        continue;
      }
      const allowed = allowedPlaceholders(key as TemplateKey);
      const unknown = placeholders(`${edit.subject ?? ""} ${edit.body}`).filter((p) => !allowed.includes(p));
      if (unknown.length) problems[key] = [`Unknown placeholder ${unknown.map((u) => `{{${u}}}`).join(", ")}. Use: ${allowed.map((a) => `{{${a}}}`).join(" ")}`];
      if (/[!]/.test(edit.body) || /\p{Extended_Pictographic}/u.test(edit.body)) {
        (problems[key] ??= []).push("No exclamation marks or emoji in payment and shipping messages.");
      }
    }
    if (Object.keys(problems).length) throw new HttpError(422, "validation_failed", "Some templates need attention.", { fields: problems });
  }

  const updated = await db.$transaction(async (tx) => {
    const current = await getSettings(tx);
    const templates = { ...((current.notificationTemplates as Prisma.JsonObject) ?? {}), ...(input.notificationTemplates ?? {}) };
    const next = await tx.setting.update({
      where: { id: current.id },
      data: {
        ...(input.volumetricDivisor !== undefined ? { volumetricDivisor: input.volumetricDivisor } : {}),
        ...(input.notificationTemplates ? { notificationTemplates: templates } : {}),
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "settings.updated",
      entityType: "settings",
      entityId: current.id,
      before: { volumetricDivisor: current.volumetricDivisor, ...(input.notificationTemplates ? { templates: Object.keys(input.notificationTemplates) } : {}) },
      after: { volumetricDivisor: next.volumetricDivisor, ...(input.notificationTemplates ? { notificationTemplates: input.notificationTemplates } : {}) },
    });
    return next;
  });

  return NextResponse.json({ settings: { volumetricDivisor: updated.volumetricDivisor, currency: updated.currency } });
});
