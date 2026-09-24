import type { Metadata } from "next";

import { AppRuntimeProviders } from "@/components/layout/AppRuntimeProviders";

/**
 * Shared floor tablets (COL-677 / COL-691, spec 40 §6). Outside the admin
 * shell and forced dark with the caregiver tokens, like the Med-Tech shell:
 * bedside use in dim rooms and night shifts. The tablet is a home-screen web
 * app; its manifest starts at /floor.
 */
export const metadata: Metadata = {
  title: "Haven Floor",
  manifest: "/floor.webmanifest",
  icons: { apple: "/apple-icon.svg" },
  appleWebApp: { capable: true, title: "Haven Floor", statusBarStyle: "black" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export default function FloorRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRuntimeProviders>
      <div className="dark">
        <div className="caregiver-shell floor-shell min-h-dvh bg-background font-sans text-foreground antialiased">{children}</div>
      </div>
    </AppRuntimeProviders>
  );
}
