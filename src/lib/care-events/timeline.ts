/**
 * Pure helpers for the resident Timeline tab (spec 07A §6.2 `v_resident_timeline`,
 * §6.3 "Resident profile Timeline tab", §7 Tier 3). The view unions care events,
 * pre-launch incidents, condition changes, behavior logs, shift notes, and
 * observation exceptions; these helpers group and label rows for the screen.
 * No raw `level_n` ever leaves this file: level words go through formatLevelWord.
 */

import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";
import type { Database } from "@/types/database";

import { isCareEventKind } from "./level-engine";
import { careEventTileWord } from "./tiles";

export type ResidentTimelineRow = Database["public"]["Views"]["v_resident_timeline"]["Row"];

export type TimelineWorkspace = "admin" | "caregiver" | "floor";

export type TimelineDayGroup = {
  /** Facility-local calendar day, `yyyy-mm-dd`, or `"unknown"` for entries with no time posted. */
  dayKey: string;
  dayLabel: string;
  rows: ResidentTimelineRow[];
};

export type TimelineRowLabel = {
  /** What happened, in words: the tile word for care events, the view title otherwise. */
  title: string;
  /** Where the entry came from, in operator words. */
  sourceWord: string;
  /** Note, Heads-up, Urgent, Emergency, or null when the entry has no level. */
  levelWord: string | null;
  /** Wall-clock time in the facility zone, or the no-date copy. */
  timeLabel: string;
};

export type TimelineLink = { label: string; href: string };

export const TIMELINE_UNKNOWN_DAY_KEY = "unknown";
export const TIMELINE_NO_TIME_COPY = "No time posted";
export const TIMELINE_EMPTY_COPY =
  "No entries yet. Care events, shift notes, and observation exceptions will appear here.";
export const TIMELINE_PAGE_SIZE = 200;

const SOURCE_WORDS: Record<string, string> = {
  care_event: "Care event",
  incident: "Incident",
  condition_change: "Condition change",
  behavior: "Behavior",
  daily_log: "Shift note",
  observation_exception: "Observation exception",
};

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Facility-local `yyyy-mm-dd` for an instant, or the unknown key. */
export function timelineDayKey(occurredAt: string | null | undefined, timeZone: string): string {
  const parsed = parseIso(occurredAt);
  if (!parsed) return TIMELINE_UNKNOWN_DAY_KEY;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

/** "Monday, September 14, 2026" from a `yyyy-mm-dd` key; the unknown key names the gap. */
export function timelineDayLabel(dayKey: string): string {
  if (dayKey === TIMELINE_UNKNOWN_DAY_KEY) return TIMELINE_NO_TIME_COPY;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return TIMELINE_NO_TIME_COPY;
  const noon = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(noon);
}

/** "10:05 PM" in the facility zone. */
export function timelineTimeLabel(occurredAt: string | null | undefined, timeZone: string): string {
  const parsed = parseIso(occurredAt);
  if (!parsed) return TIMELINE_NO_TIME_COPY;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(parsed);
}

/**
 * Newest first, grouped by facility-local day. Entries with no time posted sit
 * in one trailing group so they are never silently dropped.
 */
export function groupTimelineByDay(rows: readonly ResidentTimelineRow[], timeZone: string): TimelineDayGroup[] {
  const sorted = [...rows].sort((a, b) => {
    const at = parseIso(a.occurred_at)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bt = parseIso(b.occurred_at)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return bt - at;
  });
  const groups: TimelineDayGroup[] = [];
  const byKey = new Map<string, TimelineDayGroup>();
  for (const row of sorted) {
    const dayKey = timelineDayKey(row.occurred_at, timeZone);
    let group = byKey.get(dayKey);
    if (!group) {
      group = { dayKey, dayLabel: timelineDayLabel(dayKey), rows: [] };
      byKey.set(dayKey, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  const unknownIndex = groups.findIndex((group) => group.dayKey === TIMELINE_UNKNOWN_DAY_KEY);
  if (unknownIndex >= 0 && unknownIndex !== groups.length - 1) {
    const [unknown] = groups.splice(unknownIndex, 1);
    groups.push(unknown);
  }
  return groups;
}

export function timelineSourceWord(source: string | null | undefined): string {
  return (source && SOURCE_WORDS[source]) || "Entry";
}

/** Words for one row. Care events take the tile word from the kind; other sources keep the view title. */
export function timelineRowLabel(row: ResidentTimelineRow, timeZone: string): TimelineRowLabel {
  const sourceWord = timelineSourceWord(row.source);
  const viewTitle = row.title?.trim() || null;
  let title = viewTitle ?? sourceWord;
  if (row.source === "care_event" && isCareEventKind(row.kind)) {
    title = careEventTileWord(row.kind);
  }
  return {
    title,
    sourceWord,
    levelWord: row.level == null ? null : formatLevelWord(row.level),
    timeLabel: timelineTimeLabel(row.occurred_at, timeZone),
  };
}

/**
 * Where a row can go. Admin opens the incident and the card; caregiver opens
 * the receipt; the floor tablet opens the receipt inside its own shell.
 */
export function timelineLinkFor(workspace: TimelineWorkspace, row: ResidentTimelineRow): TimelineLink[] {
  const links: TimelineLink[] = [];
  if (workspace === "admin") {
    if (row.incident_id) links.push({ label: "Open incident", href: `/admin/incidents/${row.incident_id}` });
    if (row.care_event_id) links.push({ label: "Open card", href: `/admin/care-events/${row.care_event_id}` });
    return links;
  }
  const receiptBase = workspace === "floor" ? "/floor/report" : "/caregiver/report";
  if (row.care_event_id) links.push({ label: "Open receipt", href: `${receiptBase}/${row.care_event_id}` });
  return links;
}

/** A stable key for one row across the union (source ids can repeat across sources). */
export function timelineRowKey(row: ResidentTimelineRow): string {
  return `${row.source ?? "entry"}:${row.source_id ?? row.occurred_at ?? "none"}`;
}

/** Long or multi-line detail earns an expand control; short detail never shows one. */
export function timelineDetailNeedsExpand(detail: string | null | undefined): boolean {
  if (!detail) return false;
  return detail.length > 140 || detail.includes("\n");
}
