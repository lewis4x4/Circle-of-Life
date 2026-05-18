import type { Json } from "@/types/database";

const HISTORY_KEY = "haven_insight_history" as const;

export type HavenInsightHistoryEntry = {
  question: string;
  asked_at: string;
  outcome: "matched" | "no_match";
  template_slug?: string | null;
  template_name?: string | null;
};

export const HAVEN_INSIGHT_HISTORY_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHistoryEntry(raw: unknown): raw is HavenInsightHistoryEntry {
  if (!isRecord(raw)) return false;
  const q = raw.question;
  const ts = raw.asked_at;
  const oc = raw.outcome;
  if (typeof q !== "string" || q.trim().length === 0) return false;
  if (typeof ts !== "string" || ts.trim().length === 0) return false;
  if (oc !== "matched" && oc !== "no_match") return false;
  if (raw.template_slug != null && typeof raw.template_slug !== "string") return false;
  if (raw.template_name != null && typeof raw.template_name !== "string") return false;
  return true;
}

export function parseHavenInsightHistory(settings: Json | null): HavenInsightHistoryEntry[] {
  if (!isRecord(settings)) return [];
  const rawPrefs = settings.user_preferences;
  if (!isRecord(rawPrefs)) return [];
  const hist = rawPrefs[HISTORY_KEY];
  if (!Array.isArray(hist)) return [];
  const entries = hist.filter(isHistoryEntry);
  return [...entries].sort((a, b) => Date.parse(b.asked_at) - Date.parse(a.asked_at));
}

/** Prepend one entry (newest first), cap length, dedupe consecutive identical question. */
export function mergeHavenInsightHistory(
  settings: Json | null,
  entry: HavenInsightHistoryEntry,
): Json {
  const prev = parseHavenInsightHistory(settings);
  const dedupe =
    prev[0]?.question.trim().toLowerCase() === entry.question.trim().toLowerCase()
      ? prev.slice(1)
      : prev;
  const next = [entry, ...dedupe].slice(0, HAVEN_INSIGHT_HISTORY_LIMIT);

  const base = isRecord(settings) ? { ...settings } : {};
  const prevPrefs = isRecord(base.user_preferences) ? { ...base.user_preferences } : {};
  prevPrefs[HISTORY_KEY] = next as unknown as Json;
  base.user_preferences = prevPrefs;
  return base as Json;
}
