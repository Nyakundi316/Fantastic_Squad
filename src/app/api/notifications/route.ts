import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/api-user";
import { route } from "@/server/http";
import { effectiveTemplates, renderNotification } from "@/server/notifications/render";
import { TEMPLATE_TITLES, isTemplateKey } from "@/server/notifications/templates";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

/** The bell: latest in-app notifications. "queued" means unread; "sent" means the customer has seen it. */
export const GET = route(async (req) => {
  const user = await requireApiUser(req);
  const [rows, unread, settings] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id, channel: "in_app" }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.notification.count({ where: { userId: user.id, channel: "in_app", status: "queued" } }),
    getSettings(),
  ]);
  const templates = effectiveTemplates(settings.notificationTemplates);

  return NextResponse.json({
    unread,
    items: rows.map((n) => {
      const payload = (n.payload ?? {}) as { link?: string };
      return {
        id: n.id,
        title: isTemplateKey(n.template) ? TEMPLATE_TITLES[n.template] : "Update",
        body: renderNotification(n.template, n.payload, templates).body,
        link: typeof payload.link === "string" && payload.link.startsWith("/") ? payload.link : null,
        read: n.status !== "queued",
        createdAt: n.createdAt.toISOString(),
      };
    }),
  });
});
