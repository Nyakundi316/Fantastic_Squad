import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/wordmark";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { requireStaffViewer } from "@/server/auth/viewer";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · FANTASTICZONE" } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffViewer();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center justify-between px-4 lg:px-5">
          <Wordmark href="/admin" />
          <Badge tone="accent" className="capitalize">
            {staff.role}
          </Badge>
        </div>
        <div className="px-2 pb-2 lg:flex-1 lg:px-3 lg:pt-2">
          <AdminNav role={staff.role} />
        </div>
        <div className="hidden border-t border-border px-5 py-4 text-sm lg:block">
          <p className="truncate font-medium">{staff.name ?? staff.email ?? staff.phone}</p>
          <SignOutButton className="mt-1" />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">{children}</main>
    </div>
  );
}
