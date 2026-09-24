import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { KioskShell } from "@/components/kiosk/KioskShell";

export const metadata: Metadata = {
  title: "Front door · Haven",
  robots: { index: false, follow: false },
};

// Zoom stays enabled (WCAG 1.4.4); the kiosk is locked by Mosyle, not by the viewport meta.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1C1E21",
};

/**
 * Front-door kiosk (COL-692, spec 40 §7). Outside every route group on
 * purpose: the proxy allowlist does not match /kiosk, so no cookie or session
 * is ever required, and the device token in IndexedDB is the only credential.
 * Forced light whatever the operator theme toggle says.
 */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="light kiosk-shell min-h-dvh bg-background font-sans text-foreground">
      <KioskShell>{children}</KioskShell>
    </div>
  );
}
