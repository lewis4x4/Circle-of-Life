"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { OperatingRuleKey } from "@/lib/operating-rules/operating-rules";
import {
  describeOperatingRuleValue,
  operatingRuleValueFromDraft,
  type OperatingRuleDraft,
  type OperatingRuleSetting,
  type OperatingRulesSettingsLoad,
} from "@/lib/operating-rules/operating-rules-settings";
import { parseRiskScoreBands } from "@/lib/operating-rules/risk-bands";
import { parseBackdateWindowDays, parseDueWindowDays, parseScoreAlertBelowPct } from "@/lib/operating-rules/operating-rules";
import { createClient } from "@/lib/supabase/client";

const INPUT = "h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary tabular-nums";

function draftFromCurrent(rule: OperatingRuleSetting): OperatingRuleDraft {
  switch (rule.key) {
    case "risk.score_bands": {
      const bands = parseRiskScoreBands(rule.current);
      return {
        key: rule.key,
        critical: bands ? String(bands.critical_below) : "",
        high: bands ? String(bands.high_below) : "",
        moderate: bands ? String(bands.moderate_below) : "",
      };
    }
    case "survey_binder.due_window_days": {
      const days = parseDueWindowDays(rule.current);
      return { key: rule.key, days: days === null ? "" : String(days) };
    }
    case "compliance.score_alert_below_pct": {
      const alert = parseScoreAlertBelowPct(rule.current);
      return { key: rule.key, off: !alert || alert.off, belowPct: alert && !alert.off ? String(alert.belowPct) : "" };
    }
    case "resident_movement.backdate_window_days": {
      const days = parseBackdateWindowDays(rule.current);
      return { key: rule.key, days: days === null ? "" : String(days) };
    }
  }
}

function RuleValueFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: OperatingRuleDraft;
  onChange: (draft: OperatingRuleDraft) => void;
  idPrefix: string;
}) {
  if (draft.key === "risk.score_bands") {
    const field = (name: "critical" | "high" | "moderate", label: string) => (
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-${name}`}>
        {label}
        <input
          id={`${idPrefix}-${name}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          step={1}
          value={draft[name]}
          onChange={(e) => onChange({ ...draft, [name]: e.target.value })}
          className={`${INPUT} w-24 text-right`}
        />
      </label>
    );
    return (
      <div className="flex flex-wrap gap-3">
        {field("critical", "Critical below")}
        {field("high", "High below")}
        {field("moderate", "Moderate below")}
      </div>
    );
  }
  if (draft.key === "resident_movement.backdate_window_days") {
    return (
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-days`}>
        Days back
        <input
          id={`${idPrefix}-days`}
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          value={draft.days}
          onChange={(e) => onChange({ ...draft, days: e.target.value })}
          className={`${INPUT} w-24 text-right`}
        />
      </label>
    );
  }
  if (draft.key === "survey_binder.due_window_days") {
    return (
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-days`}>
        Days ahead
        <input
          id={`${idPrefix}-days`}
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          value={draft.days}
          onChange={(e) => onChange({ ...draft, days: e.target.value })}
          className={`${INPUT} w-24 text-right`}
        />
      </label>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex items-center gap-2 text-sm text-text-primary" htmlFor={`${idPrefix}-off`}>
        <input
          id={`${idPrefix}-off`}
          type="checkbox"
          checked={draft.off}
          onChange={(e) => onChange({ ...draft, off: e.target.checked })}
        />
        Alert off
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-pct`}>
        Alert below (%)
        <input
          id={`${idPrefix}-pct`}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          step={1}
          disabled={draft.off}
          value={draft.belowPct}
          onChange={(e) => onChange({ ...draft, belowPct: e.target.value })}
          className={`${INPUT} w-24 text-right disabled:opacity-60`}
        />
      </label>
    </div>
  );
}

function RuleCard({ rule, load }: { rule: OperatingRuleSetting; load: OperatingRulesSettingsLoad }) {
  const router = useRouter();
  const [draft, setDraft] = useState<OperatingRuleDraft>(() => draftFromCurrent(rule));
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const idPrefix = `rule-${rule.key.replace(/\W/g, "-")}`;

  const submit = async () => {
    setError(null);
    setSaved(false);
    const parsed = operatingRuleValueFromDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (!effectiveFrom || effectiveFrom < load.todayIso) {
      setError("Choose an effective date of today or later.");
      return;
    }
    if (reason.trim().length === 0) {
      setError("Say why the rule is changing.");
      return;
    }
    if (!load.organizationId || !load.userId) {
      setError("Your account has no organization, so the rule cannot be saved.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await createClient()
      .from("operating_rules" as never)
      .insert({
        organization_id: load.organizationId,
        facility_id: null,
        rule_key: rule.key satisfies OperatingRuleKey,
        value: parsed.value,
        effective_from: effectiveFrom,
        change_reason: reason.trim(),
        created_by: load.userId,
      } as never);
    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "A change for this rule is already recorded for that date. Choose another date."
          : insertError.message || "The rule could not be saved.",
      );
      return;
    }
    setSaved(true);
    setReason("");
    setEffectiveFrom("");
    router.refresh();
  };

  return (
    <section aria-label={rule.label} className="rounded-md border border-border bg-surface">
      <header className="border-b border-border px-4 py-2">
        <h3 className="text-sm font-semibold text-text-primary">{rule.label}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{rule.description}</p>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        <p className="text-text-primary">
          <span className="text-text-muted">In force today: </span>
          {describeOperatingRuleValue(rule.key, rule.current)}
        </p>
        {rule.scheduled.length > 0 ? (
          <ul className="text-xs text-text-secondary">
            {rule.scheduled.map((row) => (
              <li key={row.id}>
                From {row.effectiveFrom}: {describeOperatingRuleValue(rule.key, row.value)} — {row.changeReason}
              </li>
            ))}
          </ul>
        ) : null}
        {rule.history.length > 0 ? (
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer">History ({rule.history.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {rule.history.map((row) => (
                <li key={row.id}>
                  {row.effectiveFrom}: {describeOperatingRuleValue(rule.key, row.value)} — {row.changeReason}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-xs text-text-muted">No change recorded yet; the built-in default applies.</p>
        )}
        {load.canEdit ? (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <RuleValueFields draft={draft} onChange={setDraft} idPrefix={idPrefix} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-from`}>
                Effective from
                <input
                  id={`${idPrefix}-from`}
                  type="date"
                  min={load.todayIso}
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-reason`}>
                Reason
                <input
                  id={`${idPrefix}-reason`}
                  type="text"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={INPUT}
                />
              </label>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="inline-flex h-8 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving…" : "Record change"}
              </button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            {saved ? <p className="text-xs text-text-secondary">Change recorded.</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function OperatingRulesEditor({ load }: { load: OperatingRulesSettingsLoad }) {
  if (load.loadError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {load.loadError}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {!load.canEdit ? (
        <p className="text-xs text-text-muted">Only an owner or org admin can change these rules.</p>
      ) : null}
      {load.rules.map((rule) => (
        <RuleCard key={rule.key} rule={rule} load={load} />
      ))}
    </div>
  );
}
