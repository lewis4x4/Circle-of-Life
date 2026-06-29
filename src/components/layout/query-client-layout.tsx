"use client";

import type { ReactNode } from "react";

import { QueryProvider } from "@/components/layout/query-provider";

/** Wraps routes that call `useQuery` — kept out of `(admin)/layout` so hub pages stay under the gzip cap. */
export function QueryClientLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
