import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/wordmark";
import { MagicLinkConfirm } from "./magic-link-confirm";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false } };

export default function MagicLinkPage({ searchParams }: { searchParams: { email?: string; code?: string } }) {
  return (
    <div className="px-4 py-6 sm:px-10 lg:px-16">
      <Wordmark />
      <div className="mt-16 max-w-sm sm:mt-24">
        <MagicLinkConfirm email={searchParams.email ?? ""} code={searchParams.code ?? ""} />
      </div>
    </div>
  );
}
