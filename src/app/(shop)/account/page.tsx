import type { Metadata } from "next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { db } from "@/lib/db";
import { maskPhone } from "@/lib/contact";
import { requireViewer } from "@/server/auth/viewer";
import { AddressBook } from "./address-book";
import { NotificationPrefs } from "./notification-prefs";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const viewer = await requireViewer("/account");
  const addresses = await db.address.findMany({
    where: { userId: viewer.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="container max-w-3xl pb-16 pt-6 sm:pt-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold sm:text-3xl">Account</h1>
        <SignOutButton />
      </div>

      <section className="mt-8 grid gap-6 sm:grid-cols-[180px_1fr]">
        <h2 className="text-base font-semibold">Profile</h2>
        <div className="space-y-4">
          <ProfileForm name={viewer.name ?? ""} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="tabular">{viewer.phone ? maskPhone(viewer.phone) : "Not added"}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{viewer.email ?? "Not added"}</dd>
            {viewer.role === "dropshipper" && (
              <>
                <dt className="text-muted-foreground">Account type</dt>
                <dd>Dropshipper (bulk quantities enabled)</dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section className="mt-10 grid gap-6 border-t border-border pt-8 sm:grid-cols-[180px_1fr]">
        <div>
          <h2 className="text-base font-semibold">Addresses</h2>
          <p className="mt-1 text-sm text-muted-foreground">Where we deliver your orders.</p>
        </div>
        <AddressBook
          defaults={{ fullName: viewer.name ?? "", phone: viewer.phone ?? "" }}
          addresses={addresses.map((a) => ({
            id: a.id,
            fullName: a.fullName,
            phone: a.phone,
            summary: [a.line1, a.line2, a.city, a.state].filter(Boolean).join(", "),
            isDefault: a.isDefault,
          }))}
        />
      </section>

      <section className="mt-10 grid gap-6 border-t border-border pt-8 sm:grid-cols-[180px_1fr]">
        <div>
          <h2 className="text-base font-semibold">Notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">How we reach you.</p>
        </div>
        <NotificationPrefs
          hasEmail={Boolean(viewer.email)}
          hasPhone={Boolean(viewer.phone)}
          initial={{
            whatsapp: (viewer.notificationPrefs as { whatsapp?: boolean } | null)?.whatsapp !== false,
            email: (viewer.notificationPrefs as { email?: boolean } | null)?.email !== false,
          }}
        />
      </section>
    </div>
  );
}
