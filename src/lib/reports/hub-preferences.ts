import type { Json } from "@/types/database";

const DISMISS_KEY = "reporting_hub_onboarding_dismissed_at" as const;
const PINNED_TEMPLATES_KEY = "pinned_template_ids" as const;

export type ReportingUserPreferences = {
  [DISMISS_KEY]?: string;
  [PINNED_TEMPLATES_KEY]?: string[];
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

export function parsePinnedTemplateIds(settings: Json | null): string[] {
  if (!isRecord(settings)) return [];
  const rawPrefs = settings.user_preferences;
  if (!isRecord(rawPrefs)) return [];
  const ids = rawPrefs[PINNED_TEMPLATES_KEY];
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function mergePinnedTemplateIds(settings: Json | null, templateIds: string[]): Json {
  const base = isRecord(settings) ? { ...settings } : {};
  const prevPrefs = isRecord(base.user_preferences) ? { ...base.user_preferences } : {};
  prevPrefs[PINNED_TEMPLATES_KEY] = templateIds;
  base.user_preferences = prevPrefs;
  return base as Json;
}

/** Toggle one template UUID in `user_preferences.pinned_template_ids`; returns full `settings` JSON for profile update. */
export function togglePinnedTemplateId(settings: Json | null, templateId: string): Json {
  const cur = parsePinnedTemplateIds(settings);
  const next = cur.includes(templateId) ? cur.filter((id) => id !== templateId) : [...cur, templateId];
  return mergePinnedTemplateIds(settings, next);
}
