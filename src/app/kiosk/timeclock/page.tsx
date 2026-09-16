import type { Metadata, Viewport } from "next";

import { TimeclockKiosk } from "@/components/timeclock/TimeclockKiosk";

export const metadata: Metadata = {
  title: "Timeclock — Haven",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
