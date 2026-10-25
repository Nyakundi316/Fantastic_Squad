"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { startAnalytics, track } from "@/lib/analytics";
import "../../sentry.client.config";

function PageviewTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    startAnalytics();
    // Path only: order and invoice ids are fine, query strings can hold references.
    track("$pageview", { $current_url: `${window.location.origin}${pathname}` });
  }, [pathname, search]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: 0 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </QueryClientProvider>
  );
}
