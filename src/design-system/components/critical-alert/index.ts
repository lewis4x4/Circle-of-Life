/**
 * critical-alert — Critical Alert surface primitives
 *
 * Surface treatment per surface-map.md:
 *   Mix: Linear 40% · Stripe 30% · Mercury 20% · Pylon 10%
 *   Row height: 37px · Padding: 14px · Border radius: 10px · Hover lift: 2px
 *   Emphasis: CHROME — "Stress-time surface. Calm hierarchy, unambiguous actions."
 *
 * Usage:
 *   import { CriticalAlertBanner } from "@/design-system/components/critical-alert";
 */

export { CriticalAlertBanner } from "./CriticalAlertBanner";
export type {
  CriticalAlertBannerProps,
  CriticalAlertSeverity,
} from "./CriticalAlertBanner";
