/**
 * Settings → Threshold targets: the organization's operating rules (COL-710).
 * Pure helpers for the editor, shared by the server loader and its tests.
 */
import type { OperatingRuleKey } from "./operating-rules";
import {
  CENSUS_NOTICE_ROLE_CHOICES,
  parseBackdateWindowDays,
  parseCensusNoticeLeadMinutes,
  parseCensusNoticeRoles,
  parseCensusReasonWindowDays,
  parseDueWindowDays,
  parseScoreAlertBelowPct,
  type CensusNoticeRole,
} from "./operating-rules";
import { enumLabel } from "@/lib/display/enum-label";
import { parseRiskScoreBands } from "./risk-bands";

export type OperatingRuleHistoryRow = {
  id: string;
  ruleKey: OperatingRuleKey;
  value: unknown;
  effectiveFrom: string;
  changeReason: string;
  createdAt: string;
};

export type OperatingRuleSetting = {
  key: OperatingRuleKey;
  label: string;
  description: string;
  /** The value in force today (JSON null is a real value: "off"); undefined when it could not be read. */
  current: unknown;
  /** Rows effective after today, soonest first. */
  scheduled: OperatingRuleHistoryRow[];
  /** Every organization row, newest effective date first. */
  history: OperatingRuleHistoryRow[];
};

export type OperatingRulesSettingsLoad = {
  canEdit: boolean;
  /** Needed to write a row; null when the caller has no organization. */
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
    description: "Who is told about an open census disagreement before the Stand Up deadline, at each facility they can access.",
  },
};

/** How a census notice role reads on the settings page. */
export function censusNoticeRoleLabel(role: CensusNoticeRole): string {
  return role === "facility_admin" ? "Administrator" : enumLabel(role);
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
  }
}

export type OperatingRuleDraft =
  | { key: "risk.score_bands"; critical: string; high: string; moderate: string }
  | { key: "survey_binder.due_window_days"; days: string }
  | { key: "compliance.score_alert_below_pct"; off: boolean; belowPct: string }
  | { key: "resident_movement.backdate_window_days"; days: string }
  | { key: "stand_up.census_reason_window_days"; days: string }
  | { key: "stand_up.census_notice_lead_minutes"; minutes: string }
  | { key: "stand_up.census_notice_roles"; roles: CensusNoticeRole[] };

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
  }
}
