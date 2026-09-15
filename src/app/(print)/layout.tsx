import type { ReactNode } from "react";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";
import { HavenAuthProvider } from "@/contexts/haven-auth-context";

/**
 * Print sheets: the same identity context as the admin group, none of its chrome.
 * A printout should contain exactly the sheet, so nothing here hides a shell
 * with print CSS — there is no shell. `/print` is gated by the admin-shell
 * middleware list (session + admin-capable role).
 */
export default function PrintRouteGroupLayout({ children }: { children: ReactNode }) {
  return (
    <AppRuntimeProviders>
      <HavenAuthProvider>
        <main className="min-h-full bg-white text-black">{children}</main>
      </HavenAuthProvider>
    </AppRuntimeProviders>
  );
}
