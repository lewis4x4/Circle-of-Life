import type { Json } from "@/types/database";

const DISMISS_KEY = "reporting_hub_onboarding_dismissed_at" as const;

export type ReportingUserPreferences = {
  [DISMISS_KEY]?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReportingHubOnboardingDismissedAt(settings: Json | null): string | null {
  if (!isRecord(settings)) return null;
  const raw = settings.user_preferences;
  if (!isRecord(raw)) return null;
  const ts = raw[DISMISS_KEY];
  return typeof ts === "string" && ts.trim().length > 0 ? ts : null;
}

export function mergeReportingHubOnboardingDismissed(settings: Json | null, dismissedAtIso: string): Json {
  const base = isRecord(settings) ? { ...settings } : {};
  const prevPrefs = isRecord(base.user_preferences) ? { ...base.user_preferences } : {};
  prevPrefs[DISMISS_KEY] = dismissedAtIso;
  base.user_preferences = prevPrefs;
  return base as Json;
}
