/**
 * Settings → Threshold targets: the organization's operating rules (COL-710).
 * Pure helpers for the editor, shared by the server loader and its tests.
 */
import type { OperatingRuleKey } from "./operating-rules";
import { parseBackdateWindowDays, parseDueWindowDays, parseScoreAlertBelowPct } from "./operating-rules";
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
};

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
  }
}

export type OperatingRuleDraft =
  | { key: "risk.score_bands"; critical: string; high: string; moderate: string }
  | { key: "survey_binder.due_window_days"; days: string }
  | { key: "compliance.score_alert_below_pct"; off: boolean; belowPct: string }
  | { key: "resident_movement.backdate_window_days"; days: string };

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
  }
}
