import type { Metadata, Viewport } from "next";

import { TimeclockKiosk } from "@/components/timeclock/TimeclockKiosk";

export const metadata: Metadata = {
  title: "Timeclock — Haven",
  robots: { index: false, follow: false },
};

// Zoom stays enabled (WCAG 1.4.4); the kiosk is locked by Mosyle, not by the viewport meta.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F2EA",
};

/**
 * Session-less kiosk (COL-352). Outside the (admin) route group on purpose:
 * the proxy allowlist does not match /kiosk, so no cookie or session is ever
 * required, and the device token in IndexedDB is the only credential.
 */
export default function TimeclockKioskPage() {
  return <TimeclockKiosk />;
}
