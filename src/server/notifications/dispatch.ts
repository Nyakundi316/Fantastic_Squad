import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { sendEmail } from "@/server/messaging/email";
import { sendWhatsApp } from "@/server/messaging/whatsapp";
import { getSettings } from "@/server/settings";
import { queueNotification } from "./queue";
import { effectiveTemplates, renderNotification } from "./render";
import { OPTIONAL_TEMPLATES, isTemplateKey } from "./templates";

type Prefs = { whatsapp?: boolean; email?: boolean };

/**
 * Sends queued WhatsApp and email notifications, one row per short transaction
 * (FOR UPDATE SKIP LOCKED), so concurrent runs never send the same row twice.
 * In-app rows stay queued until the customer opens the bell.
 */
export async function dispatchPending({ budgetMs = 2000, limit = 200 }: { budgetMs?: number; limit?: number } = {}) {
  const started = Date.now();
  const templates = effectiveTemplates((await getSettings()).notificationTemplates);
  const result = { sent: 0, failed: 0 };

  while (result.sent + result.failed < limit && Date.now() - started < budgetMs) {
    const handled = await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM notifications
          WHERE status = 'queued' AND channel IN ('whatsapp', 'email')
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return null;

        const row = await tx.notification.findUniqueOrThrow({
          where: { id: rows[0]!.id },
          include: { user: { select: { phone: true, email: true, notificationPrefs: true } } },
        });
        const fail = (error: string) => tx.notification.update({ where: { id: row.id }, data: { status: "failed", error: error.slice(0, 500) } });

        const prefs = (row.user.notificationPrefs ?? {}) as Prefs;
        if (isTemplateKey(row.template) && OPTIONAL_TEMPLATES.has(row.template) && prefs[row.channel as "whatsapp" | "email"] === false) {
          await fail(`skipped: customer turned off ${row.channel} reminders`);
          return "failed";
        }

        const message = renderNotification(row.template, row.payload, templates);
        try {
          if (row.channel === "whatsapp") {
            if (!row.user.phone) {
              await fail("no phone number on file");
              return "failed";
            }
            await sendWhatsApp(row.user.phone, { template: row.template, body: message.body, params: message.params });
          } else {
            if (!row.user.email) {
              await fail("no email address on file");
              return "failed";
            }
            await sendEmail({ to: row.user.email, subject: message.subject ?? "FANTASTICZONE update", text: message.body });
          }
        } catch (err) {
          await fail(err instanceof Error ? err.message : String(err));
          return "failed";
        }
        await tx.notification.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date(), error: null } });
        return "sent";
      },
      { timeout: 20_000 },
    );
    if (handled === null) break;
    result[handled] += 1;
  }
  return result;
}

const REMINDER_LEAD_MS = 3 * 86_400_000;

/** Queues shipping_invoice_reminder for unpaid shipping invoices due within 3 days, once per invoice. */
export async function enqueueDueReminders(now = new Date()) {
  const due = await db.invoice.findMany({
    where: {
      kind: "shipping",
      status: "issued",
      dueAt: { gt: now, lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
      order: { status: "invoiced" },
    },
    include: { order: { include: { user: { select: { id: true, name: true } } } } },
  });

  let queued = 0;
  for (const invoice of due) {
    const already = await db.notification.findFirst({
      where: { template: "shipping_invoice_reminder", payload: { path: ["invoiceId"], equals: invoice.id } },
      select: { id: true },
    });
    if (already) continue;
    await db.$transaction((tx) =>
      queueNotification(tx, {
        userId: invoice.order.user.id,
        template: "shipping_invoice_reminder",
        vars: {
          name: invoice.order.user.name ?? "there",
          orderNumber: invoice.order.orderNumber,
          amount: formatMoney(invoice.amount, invoice.currency),
          dueDate: formatDate(invoice.dueAt!),
          invoiceUrl: new URL(`/invoices/${invoice.id}`, env().APP_URL).toString(),
          invoiceId: invoice.id,
        },
        link: `/invoices/${invoice.id}`,
      }),
    );
    queued += 1;
  }
  return queued;
}

/**
 * Called by routes after their transaction commits. Single-customer events go out
 * within the budget; bulk ones (approving a batch) finish on the next cron run.
 */
export async function dispatchSoon() {
  try {
    await dispatchPending({ budgetMs: 2000, limit: 50 });
  } catch (err) {
    console.error("[notifications] dispatch after commit failed", err);
  }
}
