import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { STAFF_ROLES, can, type Capability } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireStaffViewer } from "@/server/auth/viewer";
import { effectiveTemplates } from "@/server/notifications/render";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, allowedPlaceholders, type NotificationTemplate } from "@/server/notifications/templates";
import { getSettings } from "@/server/settings";
import { DivisorForm, RoleForm, TemplateEditor } from "./settings-forms";

export const metadata = { title: "Settings" };

const CAPABILITY_LABELS: Array<[Capability, string]> = [
  ["batches.manage", "Open, close and quote batches"],
  ["measurements.write", "Enter measurements"],
  ["allocation.approve", "Approve shipping split"],
  ["shipments.write", "Book and track shipments"],
  ["payments.mark_paid", "Record payments"],
  ["invoices.adjust", "Adjust invoices"],
  ["payments.export", "Export payments"],
  ["notes.write", "Internal notes"],
  ["settings.write", "Change settings and roles"],
];

export default async function SettingsPage() {
  const viewer = await requireStaffViewer("/admin/settings");
  if (!can(viewer.role, "settings.write")) redirect("/forbidden");
  const [settings, staff] = await Promise.all([
    getSettings(),
    db.user.findMany({ where: { role: { in: [...STAFF_ROLES] } }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, phone: true, role: true } }),
  ]);
  const templates = effectiveTemplates(settings.notificationTemplates);

  return (
    <div className="max-w-4xl space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="grid gap-4 sm:grid-cols-[200px_1fr] [&>*]:min-w-0">
        <div>
          <h2 className="text-base font-semibold">Money and weight</h2>
          <p className="mt-1 text-sm text-muted-foreground">Single currency, set by the CURRENCY environment variable.</p>
        </div>
        <Card className="space-y-5 p-5">
          <p className="text-sm">
            Currency <span className="tabular ml-2 font-semibold">{env().CURRENCY}</span>
          </p>
          <DivisorForm divisor={settings.volumetricDivisor} />
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-[200px_1fr] [&>*]:min-w-0">
        <div>
          <h2 className="text-base font-semibold">Notification templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used for email and the in-app bell. WhatsApp sends the Meta-approved template with the same name, so keep the wording in step.
          </p>
        </div>
        <div className="space-y-2">
          {TEMPLATE_KEYS.map((key) => {
            const base: NotificationTemplate = DEFAULT_TEMPLATES[key];
            return (
              <TemplateEditor
                key={key}
                template={{
                  key,
                  channels: base.channels.join(" + "),
                  subject: templates[key].subject,
                  body: templates[key].body,
                  defaultSubject: base.subject,
                  defaultBody: base.body,
                  allowed: allowedPlaceholders(key),
                }}
              />
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-[200px_1fr] [&>*]:min-w-0">
        <div>
          <h2 className="text-base font-semibold">Team and roles</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every role change is recorded in the audit log.</p>
        </div>
        <div className="space-y-5">
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  {member.name ?? "No name"} <span className="tabular text-muted-foreground">· {member.phone}</span>
                </span>
                <Badge tone="accent" className="capitalize">
                  {member.role}
                </Badge>
              </li>
            ))}
          </ul>
          <RoleForm />
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Can</th>
                  {STAFF_ROLES.map((r) => (
                    <th key={r} className="px-3 py-2.5 text-center font-medium capitalize">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CAPABILITY_LABELS.map(([cap, label]) => (
                  <tr key={cap}>
                    <td className="px-4 py-2">{label}</td>
                    {STAFF_ROLES.map((r) => (
                      <td key={r} className="px-3 py-2 text-center" aria-label={can(r, cap) ? "yes" : "no"}>
                        {can(r, cap) ? <span className="text-success">Yes</span> : <span className="text-muted-foreground">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
