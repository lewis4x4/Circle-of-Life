import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import type { HomeOnTapPayload, HomeOnTapRow } from "@/lib/home/on-tap";

/**
 * Pure model for the Facility Operator Home (COL-593). Everything here is
 * derived from the feed and the Command Center projection; no fetches, no
 * clock reads without an explicit `now`, no resident names.
 */

export type HomeBucket = "regulatory" | "rent" | "assigned" | "fyi";

export const HOME_VISIBLE_ROW_CAP = 7;

const BUCKET_RANK: Record<HomeBucket, number> = { regulatory: 1, rent: 2, assigned: 3, fyi: 4 };

export type HomeRowAction = {
  key: "ran" | "did_not_run" | "done" | "open";
  label: string;
  tone: "primary" | "danger" | "quiet" | "default";
  requiresNote?: boolean;
  href?: string;
};

export type HomeRowView = {
  id: string;
  bucket: HomeBucket;
  rank: number;
  title: string;
  meta: string[];
  tags: Array<{ label: string; tone: "regulatory" | "rent" | "assigned" | "fyi" | "overdue" }>;
  dueAt: string | null;
  dueLabel: string | null;
  owner: HomeOnTapRow["owner"] | null;
  actions: HomeRowAction[];
  href: string;
  /** Present only for operation task rows (never for FYI). */
  instanceId: string | null;
  catalogKey: string | null;
  /** Later rows keep their date so the list can say when they open. */
  assignedShiftDate: string | null;
  disabledReason?: string;
};

export type HomeFyiRow = {
  id: string;
  title: string;
  href: string;
  ctaLabel: string;
  overdue?: boolean;
  meta: string[];
};

const GENERATOR_CATALOG_KEY = "hfo-al-w01-01";

const CATALOG_TITLES: Record<string, string> = {
  [GENERATOR_CATALOG_KEY]: "Generator weekly run — listen and confirm it ran",
  "hfo-al-w01-02": "Carbon monoxide check — record the reading",
};

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function greetingFirstName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
}

export function greetingLine(fullName: string | null | undefined): string {
  const first = greetingFirstName(fullName);
  return first ? `Hello, ${first}.` : "Hello.";
}

function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

function localDateIso(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function formatLocalDateLong(dateIso: string, timeZone: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  // Noon UTC keeps the calendar day stable in any US zone.
  const instant = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(instant);
}

function formatShortDate(dateIso: string): string {
  const [, m, d] = dateIso.split("-");
  return `${m}/${d}`;
}

function relativeMinutes(dueAt: string, now: Date): string | null {
  const diffMs = new Date(dueAt).getTime() - now.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes > 0 && minutes <= 180) return `in ${minutes} min`;
  if (minutes < 0 && minutes >= -180) return `${Math.abs(minutes)} min ago`;
  return null;
}

/**
 * "Today 10:00 AM · in 48 min" for a row with a clock deadline today;
 * "Before you leave" when the only deadline is the operator's end of day;
 * "Overdue · 09/18" for a row carried over from an earlier day.
 */
export function dueLabelFor(row: Pick<HomeOnTapRow, "dueAt" | "assignedShiftDate" | "overdue" | "assetSchedule">, args: { now: Date; timeZone: string; localDate: string }): string {
  if (row.overdue || row.assignedShiftDate < args.localDate) {
    return `Overdue · ${formatShortDate(row.assignedShiftDate)}`;
  }
  const hasClock = Boolean(row.assetSchedule?.localTime) && Boolean(row.dueAt);
  if (hasClock && row.dueAt) {
    const time = formatLocalTime(row.dueAt, args.timeZone);
    const relative = relativeMinutes(row.dueAt, args.now);
    return relative ? `Today ${time} · ${relative}` : `Today ${time}`;
  }
  return "Before you leave";
}

export function scheduleMeta(row: Pick<HomeOnTapRow, "assetSchedule">): string | null {
  const schedule = row.assetSchedule;
  if (!schedule?.weekday || !schedule.localTime) return null;
  const [hh, mm] = schedule.localTime.split(":");
  const hour = Number(hh);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = `${((hour + 11) % 12) + 1}:${mm} ${suffix}`;
  const base = `Schedule: ${WEEKDAY_SHORT[schedule.weekday - 1]} ${display}`;
  const reset = schedule.setAt ? ` · set ${formatShortDate(schedule.setAt.slice(0, 10))}` : "";
  return base + reset;
}

export function ownerMeta(owner: HomeOnTapRow["owner"], args: { timeZone: string; currentUserId: string | null }): string {
  if (owner.kind === "queue") return "Facility queue — anyone on duty";
  const who = owner.userId === args.currentUserId ? "you" : (owner.displayName?.trim().split(/\s+/)[0] ?? "a colleague");
  const at = owner.claimedAt ? ` · ${formatLocalTime(owner.claimedAt, args.timeZone)}` : "";
  return `Claimed by ${who}${at}`;
}

export function titleFor(row: Pick<HomeOnTapRow, "title" | "catalogKey">): string {
  if (row.catalogKey && CATALOG_TITLES[row.catalogKey]) return CATALOG_TITLES[row.catalogKey];
  return row.title;
}

/** Every row carries a clearance action on the row (COL-593 rule 5). */
export function actionsFor(row: Pick<HomeOnTapRow, "catalogKey" | "requiresDualSign">): HomeRowAction[] {
  if (row.catalogKey === GENERATOR_CATALOG_KEY) {
    return [
      { key: "did_not_run", label: "Did not run", tone: "danger", requiresNote: true },
      { key: "ran", label: "It ran", tone: "primary" },
    ];
  }
  return [{ key: "done", label: row.requiresDualSign ? "Sign" : "Done", tone: "primary" }];
}

export function toRowView(row: HomeOnTapRow, args: { now: Date; timeZone: string; localDate: string; currentUserId: string | null }): HomeRowView {
  const tags: HomeRowView["tags"] = [{ label: row.bucket === "regulatory" ? "Regulatory" : "Assigned", tone: row.bucket }];
  const overdue = Boolean(row.overdue) || row.assignedShiftDate < args.localDate;
  if (overdue) tags.push({ label: "Overdue", tone: "overdue" });
  const meta = [dueLabelFor(row, args), ownerMeta(row.owner, args)];
  const schedule = scheduleMeta(row);
  if (schedule) meta.push(schedule);
  if (row.requiresDualSign) meta.push("Two signatures required");
  return {
    id: row.id,
    bucket: row.bucket,
    rank: BUCKET_RANK[row.bucket],
    title: titleFor(row),
    meta,
    tags,
    dueAt: row.dueAt ?? null,
    dueLabel: dueLabelFor(row, args),
    owner: row.owner,
    actions: actionsFor(row),
    href: row.href,
    instanceId: row.instanceId,
    catalogKey: row.catalogKey ?? null,
    assignedShiftDate: row.assignedShiftDate,
  };
}

export function toLaterRowView(row: HomeOnTapRow, args: { timeZone: string; currentUserId: string | null; now: Date; localDate: string }): HomeRowView {
  const view = toRowView(row, args);
  return {
    ...view,
    meta: [`Opens ${formatShortDate(row.assignedShiftDate)}`, ...(scheduleMeta(row) ? [scheduleMeta(row) as string] : [])],
    dueLabel: `Opens ${formatShortDate(row.assignedShiftDate)}`,
    actions: [],
    disabledReason: `Opens ${formatShortDate(row.assignedShiftDate)}`,
  };
}

export function toFyiRowView(row: HomeFyiRow): HomeRowView {
  const tags: HomeRowView["tags"] = [{ label: "FYI", tone: "fyi" }];
  if (row.overdue) tags.push({ label: "Overdue", tone: "overdue" });
  return {
    id: row.id,
    bucket: "fyi",
    rank: BUCKET_RANK.fyi,
    title: row.title,
    meta: row.meta,
    tags,
    dueAt: null,
    dueLabel: null,
    owner: null,
    actions: [{ key: "open", label: row.ctaLabel, tone: "default", href: row.href }],
    href: row.href,
    instanceId: null,
    catalogKey: null,
    assignedShiftDate: null,
  };
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/**
 * FYI rows come from the Command Center projection queues that already exist.
 * They clear themselves when the owning queue empties, so no action is offered
 * here beyond the link into that queue.
 */
export function buildFyiRows(queues: AdminDashboardSnapshot["workflowQueues"]): HomeFyiRow[] {
  const rows: HomeFyiRow[] = [];
  if (queues.referralsReadyHandoffs > 0) {
    rows.push({
      id: "fyi:referrals-ready",
      title: `${plural(queues.referralsReadyHandoffs, "referral")} ready for the admissions handoff`,
      href: "/admin/referrals/in-admissions?phase=ready",
      ctaLabel: "Open referrals",
      meta: ["Pipeline → Referrals"],
    });
  } else if (queues.referralsInAdmissions > 0) {
    rows.push({
      id: "fyi:referrals-in-admissions",
      title: `${plural(queues.referralsInAdmissions, "referral")} moving through admissions`,
      href: "/admin/referrals/in-admissions",
      ctaLabel: "Open referrals",
      meta: ["Pipeline → Referrals"],
    });
  }
  if (queues.incidentOverdueFollowups > 0) {
    rows.push({
      id: "fyi:incidents-overdue",
      title: `${plural(queues.incidentOverdueFollowups, "incident follow-up")} open past the due date`,
      href: "/admin/incidents/overdue-followups",
      ctaLabel: "Open incident",
      overdue: true,
      meta: ["Quality → Incident queue"],
    });
  }
  if (queues.incidentUnassignedFollowups > 0) {
    rows.push({
      id: "fyi:incidents-unassigned",
      title: `${plural(queues.incidentUnassignedFollowups, "incident follow-up")} with nobody assigned`,
      href: "/admin/incidents/followups?filter=unassigned",
      ctaLabel: "Assign",
      meta: ["Quality → Incident queue"],
    });
  }
  if (queues.admissionsBlocked > 0) {
    rows.push({
      id: "fyi:admissions-blocked",
      title: `${plural(queues.admissionsBlocked, "admission")} blocked before move-in`,
      href: "/admin/admissions/blocked",
      ctaLabel: "Clear blockers",
      meta: ["Pipeline → Admissions"],
    });
  }
  if (queues.familyTriagePending > 0) {
    rows.push({
      id: "fyi:family-triage",
      title: `${plural(queues.familyTriagePending, "family message")} waiting on triage`,
      href: "/admin/family-messages?filter=triage",
      ctaLabel: "Review messages",
      meta: ["Pipeline → Family notes"],
    });
  }
  return rows;
}

export type RankedOnTap = {
  rows: HomeRowView[];
  later: HomeRowView[];
  counts: { regulatory: number; rent: number; assigned: number; fyi: number; clearedToday: number; later: number };
};

/**
 * Bucket order, then due instant, then date; at most `cap` visible. Overflow
 * keeps its bucket tag and moves under "Later" ahead of the rows that are
 * genuinely later in the week.
 */
export function rankOnTap(args: {
  feed: HomeOnTapPayload;
  fyi: HomeFyiRow[];
  now: Date;
  currentUserId: string | null;
  cap?: number;
}): RankedOnTap {
  const cap = args.cap ?? HOME_VISIBLE_ROW_CAP;
  const ctx = { now: args.now, timeZone: args.feed.timezone, localDate: args.feed.localDate, currentUserId: args.currentUserId };
  const candidates: HomeRowView[] = [
    ...args.feed.rows.map((row) => toRowView(row, ctx)),
    ...args.fyi.map(toFyiRowView),
  ];
  candidates.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return (left.assignedShiftDate ?? "").localeCompare(right.assignedShiftDate ?? "");
  });
  const visible = candidates.slice(0, cap);
  const overflow = candidates.slice(cap);
  const later = [...overflow, ...args.feed.later.map((row) => toLaterRowView(row, ctx))];
  return {
    rows: visible,
    later,
    counts: {
      regulatory: args.feed.counts.regulatory,
      rent: 0,
      assigned: args.feed.counts.assigned,
      fyi: args.fyi.length,
      clearedToday: args.feed.counts.clearedToday,
      later: later.length,
    },
  };
}

/** "3 on tap before you leave" — the number the header commits to. */
export function dueBeforeYouLeaveCount(ranked: RankedOnTap): number {
  return ranked.counts.regulatory + ranked.counts.rent + ranked.counts.assigned;
}

export function coOperatorLine(feed: Pick<HomeOnTapPayload, "onDutyToday" | "coOperators">): string | null {
  const first = (name: string | null | undefined) => greetingFirstName(name);
  const onDuty = feed.onDutyToday.map((p) => first(p.displayName)).filter((n): n is string => Boolean(n));
  if (onDuty.length > 0) return `${onDuty.join(" and ")} ${onDuty.length === 1 ? "is" : "are"} on today too`;
  const co = feed.coOperators.map((p) => first(p.displayName)).filter((n): n is string => Boolean(n));
  if (co.length > 0) return `${co.join(" and ")} also cover${co.length === 1 ? "s" : ""} this building`;
  return null;
}

export function escalationFooter(feed: Pick<HomeOnTapPayload, "facilityName" | "endOfDayLocal" | "escalatesTo">): string {
  const [hh, mm] = feed.endOfDayLocal.split(":");
  const hour = Number(hh);
  const time = `${((hour + 11) % 12) + 1}:${mm} ${hour >= 12 ? "PM" : "AM"}`;
  const who = feed.escalatesTo?.displayName
    ? `${feed.escalatesTo.displayName}, ${feed.escalatesTo.title}`
    : "the Facility Executive (not yet named for this building)";
  return `Every row belongs to the ${feed.facilityName} facility queue — any Administrator, Assistant Administrator or Manager on duty. Claiming shows your name. Anything unclaimed and uncleared at ${time} goes to ${who}.`;
}

export function todayLocalDate(now: Date, timeZone: string): string {
  return localDateIso(now, timeZone);
}
