"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  ARRIVAL_APPROVAL_ROLE_CHOICES,
  CENSUS_NOTICE_CHANNEL_CHOICES,
  CENSUS_NOTICE_CHANNELS_NOT_BUILT,
  CENSUS_NOTICE_ROLE_CHOICES,
  type OperatingRuleKey,
} from "@/lib/operating-rules/operating-rules";
import {
  arrivalApprovalRoleLabel,
  CENSUS_NOTICE_CHANNEL_LABELS,
  censusNoticeRoleLabel,
  describeOperatingRuleValue,
  draftFromValue,
  operatingRuleValueFromDraft,
  type OperatingRuleDraft,
  type OperatingRuleHistoryRow,
  type OperatingRuleSetting,
  type OperatingRulesSettingsLoad,
} from "@/lib/operating-rules/operating-rules-settings";
import { createClient } from "@/lib/supabase/client";

const INPUT = "h-8 rounded-sm border border-border bg-surface px-2 text-sm text-text-primary tabular-nums";
const SMALL_BUTTON =
  "inline-flex h-8 items-center rounded-sm border border-border bg-surface px-2 text-xs font-medium text-text-primary hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60";
const MAX_CENSUS_REASONS = 12;
/** The "Applies to" choice for the whole organization; facilities use their id. */
const ORGANIZATION_SCOPE = "organization";

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
  if (draft.key === "stand_up.census_reason_window_days" || draft.key === "stand_up.census_notice_lead_minutes") {
    const days = draft.key === "stand_up.census_reason_window_days";
    return (
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-value`}>
        {days ? "Days" : "Minutes before the deadline"}
        <input
          id={`${idPrefix}-value`}
          type="number"
          inputMode="numeric"
          min={0}
          max={days ? 60 : 1440}
          step={1}
          value={days ? draft.days : draft.minutes}
          onChange={(e) => onChange(days ? { ...draft, days: e.target.value } as OperatingRuleDraft : { ...draft, minutes: e.target.value } as OperatingRuleDraft)}
          className={`${INPUT} w-24 text-right`}
        />
      </label>
    );
  }
  if (draft.key === "stand_up.census_notice_roles") {
    return (
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-text-muted">Notify</legend>
        {CENSUS_NOTICE_ROLE_CHOICES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm text-text-primary" htmlFor={`${idPrefix}-${role}`}>
            <input
              id={`${idPrefix}-${role}`}
              type="checkbox"
              checked={draft.roles.includes(role)}
              onChange={(e) => onChange({ ...draft, roles: e.target.checked ? [...draft.roles, role] : draft.roles.filter((item) => item !== role) })}
            />
            {censusNoticeRoleLabel(role)}
          </label>
        ))}
      </fieldset>
    );
  }
  if (draft.key === "stand_up.census_reason_options") {
    const reasons = draft.reasons;
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-text-muted">Reasons</legend>
        {reasons.map((reason, index) => (
          <div key={`${reason.key ?? "new"}-${index}`} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-reason-${index}`}>
              Reason {index + 1}
              <input
                id={`${idPrefix}-reason-${index}`}
                type="text"
                maxLength={80}
                value={reason.label}
                onChange={(e) =>
                  onChange({ ...draft, reasons: reasons.map((row, i) => (i === index ? { ...row, label: e.target.value } : row)) })
                }
                className={INPUT}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove reason ${index + 1}`}
              onClick={() => onChange({ ...draft, reasons: reasons.filter((_, i) => i !== index) })}
              className={SMALL_BUTTON}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            disabled={reasons.length >= MAX_CENSUS_REASONS}
            onClick={() => onChange({ ...draft, reasons: [...reasons, { key: null, label: "" }] })}
            className={SMALL_BUTTON}
          >
            Add a reason
          </button>
        </div>
        <p className="text-xs text-text-muted">
          Up to {MAX_CENSUS_REASONS} reasons. A reason you remove stays on reports where it was already given.
        </p>
      </fieldset>
    );
  }
  if (draft.key === "stand_up.census_notice_channels") {
    return (
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-text-muted">Deliver notices</legend>
        {CENSUS_NOTICE_CHANNEL_CHOICES.map((channel) => (
          <label key={channel} className="flex items-center gap-2 text-sm text-text-primary" htmlFor={`${idPrefix}-${channel}`}>
            <input
              id={`${idPrefix}-${channel}`}
              type="checkbox"
              checked={draft.channels.includes(channel)}
              onChange={(e) =>
                onChange({
                  ...draft,
                  channels: e.target.checked ? [...draft.channels, channel] : draft.channels.filter((item) => item !== channel),
                })
              }
            />
            {CENSUS_NOTICE_CHANNEL_LABELS[channel]}
          </label>
        ))}
        {CENSUS_NOTICE_CHANNELS_NOT_BUILT.map((channel) => (
          <label key={channel} className="flex items-center gap-2 text-sm text-text-muted" htmlFor={`${idPrefix}-${channel}`}>
            <input id={`${idPrefix}-${channel}`} type="checkbox" checked={false} disabled readOnly />
            {CENSUS_NOTICE_CHANNEL_LABELS[channel]} (not available yet)
          </label>
        ))}
      </fieldset>
    );
  }
  if (draft.key === "stand_up.thursday_bridge_tolerance") {
    return (
      <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-residents`}>
        Residents either way
        <input
          id={`${idPrefix}-residents`}
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          step={1}
          value={draft.residents}
          onChange={(e) => onChange({ ...draft, residents: e.target.value })}
          className={`${INPUT} w-24 text-right`}
        />
      </label>
    );
  }
  if (
    draft.key === "stand_up.thursday_census_vs_monday" ||
    draft.key === "stand_up.thursday_admission_notes_to_recruiters" ||
    draft.key === "stand_up.census_bridge_hospital_in_census" ||
    draft.key === "stand_up.thursday_admission_workflow_to_recruiters"
  ) {
    const radio = (on: boolean) => (
      <label className="flex items-center gap-2 text-sm text-text-primary" htmlFor={`${idPrefix}-${on ? "on" : "off"}`}>
        <input
          id={`${idPrefix}-${on ? "on" : "off"}`}
          type="radio"
          name={`${idPrefix}-switch`}
          checked={draft.on === on}
          onChange={() => onChange({ ...draft, on })}
        />
        {on ? "On" : "Off"}
      </label>
    );
    return (
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-text-muted">Setting</legend>
        {radio(true)}
        {radio(false)}
      </fieldset>
    );
  }
  if (draft.key === "admissions.arrival_approval_roles") {
    return (
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-text-muted">Who may approve</legend>
        {ARRIVAL_APPROVAL_ROLE_CHOICES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm text-text-primary" htmlFor={`${idPrefix}-${role}`}>
            <input
              id={`${idPrefix}-${role}`}
              type="checkbox"
              checked={draft.roles.includes(role)}
              onChange={(e) => onChange({ ...draft, roles: e.target.checked ? [...draft.roles, role] : draft.roles.filter((item) => item !== role) })}
            />
            {arrivalApprovalRoleLabel(role)}
          </label>
        ))}
      </fieldset>
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

function scopeName(facilityId: string | null, names: Map<string, string>): string {
  if (!facilityId) return "Organization";
  return names.get(facilityId) ?? "Another facility";
}

function RuleCard({ rule, load }: { rule: OperatingRuleSetting; load: OperatingRulesSettingsLoad }) {
  const router = useRouter();
  const scopes = [
    ...(load.canEditOrganization ? [{ value: ORGANIZATION_SCOPE, label: "Whole organization" }] : []),
    ...load.facilities.map((facility) => ({ value: facility.id, label: facility.name })),
  ];
  const valueForScope = (value: string) =>
    value === ORGANIZATION_SCOPE ? rule.current : (rule.facilityOverrides.find((row) => row.facilityId === value)?.value ?? rule.current);
  const [scope, setScope] = useState<string>(() => scopes[0]?.value ?? "");
  const [draft, setDraft] = useState<OperatingRuleDraft>(() => draftFromValue(rule.key, valueForScope(scopes[0]?.value ?? ORGANIZATION_SCOPE)));
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const idPrefix = `rule-${rule.key.replace(/\W/g, "-")}`;
  const names = new Map(load.facilities.map((facility) => [facility.id, facility.name]));
  const describe = (value: unknown) => describeOperatingRuleValue(rule.key, value);
  const rowLine = (row: OperatingRuleHistoryRow, from: boolean) =>
    `${scopeName(row.facilityId, names)}, ${from ? "from " : ""}${row.effectiveFrom}: ${describe(row.value)} — ${row.changeReason}`;

  const changeScope = (value: string) => {
    setScope(value);
    setDraft(draftFromValue(rule.key, valueForScope(value)));
    setError(null);
    setSaved(false);
  };

  const submit = async () => {
    setError(null);
    setSaved(false);
    if (!scope) {
      setError("Choose where the rule applies.");
      return;
    }
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
    const { error: recordError } = await createClient().rpc(
      "operating_rule_record" as never,
      {
        p_rule_key: rule.key satisfies OperatingRuleKey,
        p_facility_id: scope === ORGANIZATION_SCOPE ? null : scope,
        p_value: parsed.value,
        p_effective_from: effectiveFrom,
        p_change_reason: reason.trim(),
      } as never,
    );
    setSaving(false);
    if (recordError) {
      setError(
        recordError.code === "23505"
          ? "A change for this rule is already recorded for that date. Choose another date."
          : recordError.code === "42501"
            ? "You cannot change this rule for that scope."
            : recordError.message || "The rule could not be saved.",
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
          <span className="text-text-muted">Organization, in force today: </span>
          {describe(rule.current)}
        </p>
        {rule.facilityOverrides.length > 0 ? (
          <ul className="flex flex-col gap-1 text-text-primary">
            {rule.facilityOverrides.map((row) => (
              <li key={row.facilityId}>
                <span className="text-text-muted">At {row.facilityName} (from {row.effectiveFrom}): </span>
                {describe(row.value)}
              </li>
            ))}
          </ul>
        ) : null}
        {rule.scheduled.length > 0 ? (
          <ul className="text-xs text-text-secondary">
            {rule.scheduled.map((row) => (
              <li key={row.id}>{rowLine(row, true)}</li>
            ))}
          </ul>
        ) : null}
        {rule.history.length > 0 ? (
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer">History ({rule.history.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {rule.history.map((row) => (
                <li key={row.id}>{rowLine(row, false)}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-xs text-text-muted">No change recorded yet; the built-in default applies.</p>
        )}
        {load.canEdit && scopes.length === 0 ? (
          <p className="border-t border-border pt-3 text-xs text-text-muted">You have no facility to set this rule for.</p>
        ) : null}
        {load.canEdit && scopes.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idPrefix}-scope`}>
              Applies to
              <select
                id={`${idPrefix}-scope`}
                value={scope}
                onChange={(e) => changeScope(e.target.value)}
                className={`${INPUT} w-64 max-w-full`}
              >
                {scopes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
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
        <p className="text-xs text-text-muted">Only an owner, an org admin or a facility&apos;s administrator can change these rules.</p>
      ) : null}
      {load.canEdit && !load.canEditOrganization ? (
        <p className="text-xs text-text-muted">
          You can set a rule for the facilities you run. The rule for the whole organization is set by an owner or org admin.
        </p>
      ) : null}
      {load.rules.map((rule) => (
        <RuleCard key={rule.key} rule={rule} load={load} />
      ))}
    </div>
  );
}
