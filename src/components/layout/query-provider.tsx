"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * App-wide React Query provider.
 *
 * Mounted in {@link AppRuntimeProviders} so the cache wraps every shell and
 * therefore every page that calls `useQuery`. The `QueryClient` is created once
 * per browser session via `useState(() => ...)` so it stays stable across
 * re-renders (a fresh client on every render would defeat caching).
 *
 * Defaults are tuned for the audit's round-trip problem: a short `staleTime`
 * makes repeat navigations / Back serve cached data instead of re-fetching from
 * a cold spinner, while `refetchOnWindowFocus: false` stops tab-switches from
 * re-running every query.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 45_000,
            gcTime: 300_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
