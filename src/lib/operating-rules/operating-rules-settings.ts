/**
 * Settings → Threshold targets: the operating rules (COL-710), for the whole
 * organization or one facility (COL-555, migration 534).
 * Pure helpers for the editor, shared by the server loader and its tests.
 */
import type { OperatingRuleKey } from "./operating-rules";
import {
  ARRIVAL_APPROVAL_ROLE_CHOICES,
  CENSUS_NOTICE_CHANNEL_CHOICES,
  CENSUS_NOTICE_ROLE_CHOICES,
  parseArrivalApprovalRoles,
  parseBackdateWindowDays,
  parseBridgeTolerance,
  parseCensusNoticeChannels,
  parseCensusNoticeLeadMinutes,
  parseCensusNoticeRoles,
  parseCensusReasonOptions,
  parseCensusReasonWindowDays,
  parseDueWindowDays,
  parseScoreAlertBelowPct,
  parseSwitch,
  type ArrivalApprovalRole,
  type CensusNoticeRole,
  type CensusReasonOption,
} from "./operating-rules";
import { enumLabel } from "@/lib/display/enum-label";
import { parseRiskScoreBands } from "./risk-bands";

export type OperatingRuleHistoryRow = {
  id: string;
  ruleKey: OperatingRuleKey;
  /** Null for the organization rule. */
  facilityId: string | null;
  value: unknown;
  effectiveFrom: string;
  changeReason: string;
  createdAt: string;
};

/** A facility's own value for a rule, in force today. */
export type OperatingRuleFacilityOverride = {
  facilityId: string;
  facilityName: string;
  value: unknown;
  effectiveFrom: string;
};

export type OperatingRuleSetting = {
  key: OperatingRuleKey;
  label: string;
  description: string;
  /** The organization value in force today (JSON null is a real value: "off"); undefined when it could not be read. */
  current: unknown;
  /** Facility values in force today, by facility name. */
  facilityOverrides: OperatingRuleFacilityOverride[];
  /** Rows effective after today, soonest first. */
  scheduled: OperatingRuleHistoryRow[];
  /** Every organization and facility row the caller can read, newest effective date first. */
  history: OperatingRuleHistoryRow[];
};

export type OperatingRuleFacility = { id: string; name: string };

export type OperatingRulesSettingsLoad = {
  /** Owner, org admin or facility administrator: may set a rule for a facility they can access. */
  canEdit: boolean;
  /** Owner or org admin: may also set the organization rule. */
  canEditOrganization: boolean;
  /** Facilities the caller can access, by name. */
  facilities: OperatingRuleFacility[];
  /** Null when the caller has no organization. */
  organizationId: string | null;
  userId: string | null;
  todayIso: string;
  loadError: string | null;
  rules: OperatingRuleSetting[];
};

export const OPERATING_RULE_COPY: Record<OperatingRuleKey, { label: string; description: string }> = {
  "risk.score_bands": {
    label: "Risk score bands",
    description:
      "Nightly risk scores below the critical line are critical, below the high line high, below the moderate line moderate, and the rest low. High and critical scores alert owners.",
  },
  "survey_binder.due_window_days": {
    label: "Survey binder look-ahead",
    description: "How many days ahead the survey binder counts documents expiring and drills coming due.",
  },
  "compliance.score_alert_below_pct": {
    label: "Compliance pass-rate alert",
    description: "Show an alert on the compliance hub when a building's rule pass rate falls below this percentage. Off unless set.",
  },
  "resident_movement.backdate_window_days": {
    label: "Resident movement back-dating",
    description:
      "How many days back staff may date a discharge, hospital trip, leave or arrival when it is entered late. Older than this needs an owner or org admin and a reason. 0 means only an owner or org admin may back-date.",
  },
  "stand_up.census_reason_window_days": {
    label: "Stand Up census reason lasts",
    description:
      "When a Stand Up census differs from the resident roster and a reason is given, how many days the reason keeps it explained. It opens again after that, or as soon as the roster changes. 0 means a reason never holds.",
  },
  "stand_up.census_notice_lead_minutes": {
    label: "Stand Up census notice lead time",
    description:
      "How long before each Stand Up entry deadline an open census disagreement notifies the people below. A second notice goes out at the deadline. 0 means the only notice is at the deadline.",
  },
  "stand_up.census_notice_roles": {
    label: "Stand Up census notice goes to",
    description:
      "Who is told about an open census disagreement before the Stand Up deadline, at each facility they can access. The notice shows on their Home page and on Stand Up.",
  },
  "stand_up.census_reason_options": {
    label: "Stand Up census reasons",
    description:
      "The reasons an administrator can choose when a Monday or Thursday Stand Up census or hospital figure differs from the resident roster. A reason you remove stays on reports where it was already given.",
  },
  "stand_up.census_notice_channels": {
    label: "Stand Up census notice delivery",
    description:
      "How a census disagreement notice reaches people. Notices are delivered in Haven; push and text are not available yet. Leave it unticked to send no census notices.",
  },
  "stand_up.thursday_census_vs_monday": {
    label: "Thursday census checked against Monday",
    description:
      "When on, Thursday's census and hospital figures are also checked against the census bridge: Monday's submitted figure plus arrivals, minus departures, and hospital or rehab stays and returns where they change census. A legitimate move since Monday is never flagged. When off, Thursday is compared with the roster only.",
  },
  "stand_up.thursday_bridge_tolerance": {
    label: "Thursday census bridge tolerance",
    description:
      "How many residents either way Thursday's census may be from the census bridge's expected figure and still match. 0 means it must match exactly.",
  },
  "stand_up.census_bridge_hospital_in_census": {
    label: "Hospital and rehab stays count in census",
    description:
      "When on, a resident at a hospital or in rehab stays in the census, as the resident roster counts them, so the bridge shows stays and returns without changing the expected census. When off, the bridge subtracts each stay and adds each return.",
  },
  "stand_up.thursday_admission_workflow_to_recruiters": {
    label: "Recruiters read admission steps on the Thursday report",
    description:
      "When on, recruiters see each potential resident's admission steps, quoted-rate notes and paperwork notes on the Thursday Stand Up report. Nothing clinical is ever included.",
  },
  "stand_up.thursday_admission_notes_to_recruiters": {
    label: "Recruiters read admission notes on the Thursday report",
    description: "When on, recruiters see the admission notes on the Thursday Stand Up report. When off, those notes are hidden from recruiters.",
  },
  "admissions.arrival_approval_roles": {
    label: "Who approves an arrival",
    description:
      "Who may approve a new resident's arrival before it is confirmed. The approval itself cannot be switched off; this only sets who may give it.",
  },
};

/** How a census notice channel reads on the settings page. */
export const CENSUS_NOTICE_CHANNEL_LABELS: Record<string, string> = {
  in_app: "In Haven (Home and the Stand Up page)",
  push: "Push notification",
  sms: "Text message",
};

/** How an arrival approval role reads on the settings page. */
export function arrivalApprovalRoleLabel(role: ArrivalApprovalRole): string {
  return enumLabel(role, { overrides: { facility_admin: "Administrator", admin_assistant: "Assistant administrator" } });
}

const REASON_KEY_MAX = 40;

/**
 * A key for a new census reason, from its label: lowercase, anything but a
 * letter or digit becomes "_", it starts with a letter, is at most 40
 * characters, and is made unique against `taken` with a numeric suffix.
 */
export function censusReasonKeyFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .slice(0, REASON_KEY_MAX)
      .replace(/_+$/, "") || "reason";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, REASON_KEY_MAX - suffix.length).replace(/_+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * For each facility, its latest row effective on or before today (the value
 * the resolver uses there instead of the organization's).
 */
export function facilityOverridesInForce(
  rows: OperatingRuleHistoryRow[],
  facilities: OperatingRuleFacility[],
  todayIso: string,
): OperatingRuleFacilityOverride[] {
  const latest = new Map<string, OperatingRuleHistoryRow>();
  for (const row of rows) {
    if (!row.facilityId || row.effectiveFrom > todayIso) continue;
    const held = latest.get(row.facilityId);
    if (
      !held ||
      row.effectiveFrom > held.effectiveFrom ||
      (row.effectiveFrom === held.effectiveFrom && row.createdAt > held.createdAt)
    ) {
      latest.set(row.facilityId, row);
    }
  }
  const names = new Map(facilities.map((f) => [f.id, f.name]));
  return [...latest.values()]
    .map((row) => ({
      facilityId: row.facilityId!,
      facilityName: names.get(row.facilityId!) ?? "Another facility",
      value: row.value,
      effectiveFrom: row.effectiveFrom,
    }))
    .sort((a, b) => a.facilityName.localeCompare(b.facilityName));
}

/** How a census notice role reads on the settings page. */
export function censusNoticeRoleLabel(role: CensusNoticeRole): string {
  return enumLabel(role, { overrides: { facility_admin: "Administrator", admin_assistant: "Assistant administrator" } });
}

/** Human summary of a rule value, for the current and scheduled lines. */
export function describeOperatingRuleValue(key: OperatingRuleKey, value: unknown): string {
  switch (key) {
    case "risk.score_bands": {
      const bands = parseRiskScoreBands(value);
      return bands
        ? `Critical below ${bands.critical_below} · high below ${bands.high_below} · moderate below ${bands.moderate_below}`
        : "Not readable";
    }
    case "survey_binder.due_window_days": {
      const days = parseDueWindowDays(value);
      return days === null ? "Not readable" : `${days} days`;
    }
    case "compliance.score_alert_below_pct": {
      const rule = parseScoreAlertBelowPct(value);
      if (!rule) return "Not readable";
      return rule.off ? "Off" : `Alert below ${rule.belowPct}%`;
    }
    case "resident_movement.backdate_window_days": {
      const days = parseBackdateWindowDays(value);
      if (days === null) return "Not readable";
      if (days === 0) return "Owner or org admin only";
      return days === 1 ? "Up to 1 day back" : `Up to ${days} days back`;
    }
    case "stand_up.census_reason_window_days": {
      const days = parseCensusReasonWindowDays(value);
      if (days === null) return "Not readable";
      if (days === 0) return "A reason never holds";
      return days === 1 ? "1 day" : `${days} days`;
    }
    case "stand_up.census_notice_lead_minutes": {
      const minutes = parseCensusNoticeLeadMinutes(value);
      if (minutes === null) return "Not readable";
      if (minutes === 0) return "At the deadline only";
      return `${minutes} minutes before the deadline, and at it`;
    }
    case "stand_up.census_notice_roles": {
      const roles = parseCensusNoticeRoles(value);
      return roles ? roles.map(censusNoticeRoleLabel).join(", ") : "Not readable";
    }
    case "stand_up.census_reason_options": {
      const reasons = parseCensusReasonOptions(value);
      return reasons ? reasons.map((reason) => reason.label).join(", ") : "Not readable";
    }
    case "stand_up.census_notice_channels": {
      const channels = parseCensusNoticeChannels(value);
      if (!channels) return "Not readable";
      return channels.length === 0 ? "No notices" : channels.map((channel) => CENSUS_NOTICE_CHANNEL_LABELS[channel]).join(", ");
    }
    case "stand_up.thursday_census_vs_monday": {
      const on = parseSwitch(value);
      if (on === null) return "Not readable";
      return on
        ? "On: Thursday's census and hospital figures are also checked against the census bridge from Monday"
        : "Off: Thursday is compared with the roster only";
    }
    case "stand_up.thursday_bridge_tolerance": {
      const n = parseBridgeTolerance(value);
      if (n === null) return "Not readable";
      if (n === 0) return "Must match exactly";
      return n === 1 ? "Within 1 resident" : `Within ${n} residents`;
    }
    case "stand_up.census_bridge_hospital_in_census": {
      const on = parseSwitch(value);
      if (on === null) return "Not readable";
      return on ? "On: hospital and rehab stays stay in census" : "Off: a hospital or rehab stay leaves the census until the return";
    }
    case "stand_up.thursday_admission_workflow_to_recruiters": {
      const on = parseSwitch(value);
      if (on === null) return "Not readable";
      return on ? "On: recruiters read admission steps and paperwork notes" : "Off: admission steps are hidden from recruiters";
    }
    case "stand_up.thursday_admission_notes_to_recruiters": {
      const on = parseSwitch(value);
      if (on === null) return "Not readable";
      return on ? "On: recruiters read admission notes on the Thursday report" : "Off: admission notes are hidden from recruiters";
    }
    case "admissions.arrival_approval_roles": {
      const roles = parseArrivalApprovalRoles(value);
      return roles ? roles.map(arrivalApprovalRoleLabel).join(", ") : "Not readable";
    }
  }
}

/** One row of the census reason editor. `key` is null for a reason added in the form. */
export type CensusReasonDraftRow = { key: string | null; label: string };

export type OperatingRuleDraft =
  | { key: "risk.score_bands"; critical: string; high: string; moderate: string }
  | { key: "survey_binder.due_window_days"; days: string }
  | { key: "compliance.score_alert_below_pct"; off: boolean; belowPct: string }
  | { key: "resident_movement.backdate_window_days"; days: string }
  | { key: "stand_up.census_reason_window_days"; days: string }
  | { key: "stand_up.census_notice_lead_minutes"; minutes: string }
  | { key: "stand_up.census_notice_roles"; roles: CensusNoticeRole[] }
  | { key: "stand_up.census_reason_options"; reasons: CensusReasonDraftRow[] }
  | { key: "stand_up.census_notice_channels"; channels: string[] }
  | { key: "stand_up.thursday_census_vs_monday"; on: boolean | null }
  | { key: "stand_up.thursday_admission_notes_to_recruiters"; on: boolean | null }
  | { key: "stand_up.census_bridge_hospital_in_census"; on: boolean | null }
  | { key: "stand_up.thursday_admission_workflow_to_recruiters"; on: boolean | null }
  | { key: "stand_up.thursday_bridge_tolerance"; residents: string }
  | { key: "admissions.arrival_approval_roles"; roles: ArrivalApprovalRole[] };

/** The form's starting state for a rule value (an unreadable value starts blank). */
export function draftFromValue(key: OperatingRuleKey, value: unknown): OperatingRuleDraft {
  switch (key) {
    case "risk.score_bands": {
      const bands = parseRiskScoreBands(value);
      return {
        key,
        critical: bands ? String(bands.critical_below) : "",
        high: bands ? String(bands.high_below) : "",
        moderate: bands ? String(bands.moderate_below) : "",
      };
    }
    case "survey_binder.due_window_days": {
      const days = parseDueWindowDays(value);
      return { key, days: days === null ? "" : String(days) };
    }
    case "compliance.score_alert_below_pct": {
      const alert = parseScoreAlertBelowPct(value);
      return { key, off: !alert || alert.off, belowPct: alert && !alert.off ? String(alert.belowPct) : "" };
    }
    case "resident_movement.backdate_window_days": {
      const days = parseBackdateWindowDays(value);
      return { key, days: days === null ? "" : String(days) };
    }
    case "stand_up.census_reason_window_days": {
      const days = parseCensusReasonWindowDays(value);
      return { key, days: days === null ? "" : String(days) };
    }
    case "stand_up.census_notice_lead_minutes": {
      const minutes = parseCensusNoticeLeadMinutes(value);
      return { key, minutes: minutes === null ? "" : String(minutes) };
    }
    case "stand_up.census_notice_roles":
      return { key, roles: parseCensusNoticeRoles(value) ?? [] };
    case "stand_up.census_reason_options":
      return { key, reasons: (parseCensusReasonOptions(value) ?? []).map((reason) => ({ key: reason.key, label: reason.label })) };
    case "stand_up.census_notice_channels":
      return { key, channels: parseCensusNoticeChannels(value) ?? [] };
    case "stand_up.thursday_census_vs_monday":
    case "stand_up.thursday_admission_notes_to_recruiters":
    case "stand_up.census_bridge_hospital_in_census":
    case "stand_up.thursday_admission_workflow_to_recruiters":
      return { key, on: parseSwitch(value) };
    case "stand_up.thursday_bridge_tolerance": {
      const n = parseBridgeTolerance(value);
      return { key, residents: n === null ? "" : String(n) };
    }
    case "admissions.arrival_approval_roles":
      return { key, roles: parseArrivalApprovalRoles(value) ?? [] };
  }
}

/** The census reason list the database will accept, new rows keyed from their labels. */
function censusReasonsFromDraft(rows: CensusReasonDraftRow[]): { ok: true; value: CensusReasonOption[] } | { ok: false; error: string } {
  if (rows.length < 1 || rows.length > 12) return { ok: false, error: "Keep between 1 and 12 reasons." };
  const labels = new Set<string>();
  for (const row of rows) {
    const label = row.label.trim();
    if (label.length < 1 || label.length > 80) return { ok: false, error: "Give every reason a name of 1 to 80 characters." };
    if (labels.has(label.toLowerCase())) return { ok: false, error: `"${label}" is listed twice. Give each reason a different name.` };
    labels.add(label.toLowerCase());
  }
  const taken = new Set(rows.flatMap((row) => (row.key ? [row.key] : [])));
  if (taken.size !== rows.filter((row) => row.key).length) return { ok: false, error: "Two reasons share a key. Reload the page and try again." };
  const value = rows.map((row) => {
    const label = row.label.trim();
    if (row.key) return { key: row.key, label };
    const key = censusReasonKeyFromLabel(label, taken);
    taken.add(key);
    return { key, label };
  });
  return parseCensusReasonOptions(value) ? { ok: true, value } : { ok: false, error: "These reasons cannot be saved. Check each name." };
}

/**
 * Turns the form into a value the database will accept, or a message saying
 * what to fix. The database trigger enforces the same bounds.
 */
export function operatingRuleValueFromDraft(draft: OperatingRuleDraft): { ok: true; value: unknown } | { ok: false; error: string } {
  const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  switch (draft.key) {
    case "risk.score_bands": {
      const value = { critical_below: whole(draft.critical), high_below: whole(draft.high), moderate_below: whole(draft.moderate) };
      return parseRiskScoreBands(value)
        ? { ok: true, value }
        : { ok: false, error: "Enter whole numbers that rise: critical < high < moderate, between 1 and 100." };
    }
    case "survey_binder.due_window_days": {
      const days = whole(draft.days);
      return days !== null && parseDueWindowDays(days) !== null
        ? { ok: true, value: days }
        : { ok: false, error: "Enter a whole number of days from 1 to 365." };
    }
    case "compliance.score_alert_below_pct": {
      if (draft.off) return { ok: true, value: null };
      const pct = whole(draft.belowPct);
      return pct !== null && pct >= 1 && pct <= 100
        ? { ok: true, value: pct }
        : { ok: false, error: "Enter a whole percentage from 1 to 100, or switch the alert off." };
    }
    case "resident_movement.backdate_window_days": {
      const days = whole(draft.days);
      return days !== null && parseBackdateWindowDays(days) !== null
        ? { ok: true, value: days }
        : { ok: false, error: "Enter a whole number of days from 0 to 365." };
    }
    case "stand_up.census_reason_window_days": {
      const days = whole(draft.days);
      return days !== null && parseCensusReasonWindowDays(days) !== null
        ? { ok: true, value: days }
        : { ok: false, error: "Enter a whole number of days from 0 to 60." };
    }
    case "stand_up.census_notice_lead_minutes": {
      const minutes = whole(draft.minutes);
      return minutes !== null && parseCensusNoticeLeadMinutes(minutes) !== null
        ? { ok: true, value: minutes }
        : { ok: false, error: "Enter a whole number of minutes from 0 to 1440." };
    }
    case "stand_up.census_notice_roles": {
      const roles = CENSUS_NOTICE_ROLE_CHOICES.filter((role) => draft.roles.includes(role));
      return roles.length > 0 ? { ok: true, value: roles } : { ok: false, error: "Choose at least one role." };
    }
    case "stand_up.census_reason_options":
      return censusReasonsFromDraft(draft.reasons);
    case "stand_up.census_notice_channels": {
      if (draft.channels.some((channel) => !(CENSUS_NOTICE_CHANNEL_CHOICES as readonly string[]).includes(channel))) {
        return { ok: false, error: "Push and text delivery are not available yet. Census notices are delivered in Haven." };
      }
      const channels = CENSUS_NOTICE_CHANNEL_CHOICES.filter((channel) => draft.channels.includes(channel));
      return { ok: true, value: channels };
    }
    case "stand_up.thursday_census_vs_monday":
    case "stand_up.thursday_admission_notes_to_recruiters":
    case "stand_up.census_bridge_hospital_in_census":
    case "stand_up.thursday_admission_workflow_to_recruiters":
      return draft.on === null ? { ok: false, error: "Choose On or Off." } : { ok: true, value: draft.on };
    case "stand_up.thursday_bridge_tolerance": {
      const n = whole(draft.residents);
      return n !== null && parseBridgeTolerance(n) !== null
        ? { ok: true, value: n }
        : { ok: false, error: "Enter a whole number of residents from 0 to 20." };
    }
    case "admissions.arrival_approval_roles": {
      const roles = ARRIVAL_APPROVAL_ROLE_CHOICES.filter((role) => draft.roles.includes(role));
      return roles.length > 0
        ? { ok: true, value: roles }
        : { ok: false, error: "Choose at least one role. An arrival always needs an approval." };
    }
  }
}
