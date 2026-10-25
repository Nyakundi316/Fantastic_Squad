import { Wordmark } from "@/components/brand/wordmark";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="px-4 py-6 sm:px-10">
      <Wordmark />
      <div className="mt-16 max-w-sm">
        <h1 className="text-2xl font-semibold">You are offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Orders, invoices and payments need a connection so you always see current figures. Reconnect and try again.
        </p>
      </div>
    </div>
  );
}
