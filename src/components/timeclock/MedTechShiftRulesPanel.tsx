"use client";

/**
 * Med-Tech cockpit shift rule for one facility (COL-681). Brian's ruling
 * (COL-668) is the organization default: the shift opens on clock-in and closes
 * on clock-out. Owners and org admins change the default; facility admins set
 * their building's override. A change is a new effective-dated row with a
 * reason, never an edit, so history stays readable.
 */

import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  MED_TECH_SHIFT_CLOSE_LABELS,
  MED_TECH_SHIFT_OPEN_LABELS,
  canSetFacilityShiftRule,
  canSetOrganizationShiftRule,
  insertMedTechShiftRule,
  loadMedTechShiftRules,
  medTechShiftRuleAt,
  type MedTechShiftCloseTrigger,
  type MedTechShiftOpenTrigger,
  type MedTechShiftRule,
} from "@/lib/med-tech/shift-rules";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import { createClient } from "@/lib/supabase/client";

const FIELD = "mt-1 block h-9 rounded-[8px] border border-border bg-background px-2 text-sm";
const LABEL = "text-xs font-medium text-muted-foreground";

type Draft = {
  scope: "" | "facility" | "organization";
  open: "" | MedTechShiftOpenTrigger;
  close: "" | MedTechShiftCloseTrigger;
  effectiveFrom: string;
  reason: string;
};
const EMPTY_DRAFT: Draft = { scope: "", open: "", close: "", effectiveFrom: "", reason: "" };

function formatWhen(iso: string): string {
  return formatDisplayDateTime(iso);
}

export type MedTechShiftRulesPanelProps = {
  facilityId: string;
  facilityName: string;
  now?: () => Date;
};

export function MedTechShiftRulesPanel({ facilityId, facilityName, now = () => new Date() }: MedTechShiftRulesPanelProps) {
  const { appRole, organizationId, user } = useHavenAuth();
  const [rules, setRules] = useState<MedTechShiftRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSetFacility = canSetFacilityShiftRule(appRole);
  const canSetOrganization = canSetOrganizationShiftRule(appRole);

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!organizationId) return;
    setError(null);
    try {
      const loaded = await loadMedTechShiftRules(createClient(), organizationId, facilityId);
      if (!isCurrent()) return;
      setRules(loaded);
    } catch (e) {
      if (!isCurrent()) return;
      setRules(null);
      setError(e instanceof Error ? e.message : "Could not load the med-tech shift rule.");
    }
  }, [facilityId, organizationId]);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const current = rules ? medTechShiftRuleAt(rules, facilityId, now()) : null;
  const history = (rules ?? []).slice(0, 8);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationId || !user || !draft.scope || !draft.open || !draft.close || !draft.effectiveFrom) return;
    const effectiveFrom = new Date(draft.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() < now().getTime() - 60_000) {
      setSaveError("A rule takes effect now or later; it cannot be backdated.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await insertMedTechShiftRule(createClient(), {
        organizationId,
        facilityId: draft.scope === "organization" ? null : facilityId,
        openTrigger: draft.open,
        closeTrigger: draft.close,
        effectiveFrom,
        reason: draft.reason,
        createdBy: user.id,
      });
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="med-tech-shift-rule-heading">
      <div>
        <h2 id="med-tech-shift-rule-heading" className="text-sm font-semibold">
          Med-Tech cockpit shift
        </h2>
        <p className="text-xs text-muted-foreground">
          What opens and closes a med-tech&apos;s cockpit shift at {facilityName || "this facility"}.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : rules == null ? (
        <p className="text-sm text-muted-foreground">Loading the rule…</p>
      ) : current ? (
        <div className="text-sm" data-testid="med-tech-shift-rule-current">
          <p>
            {MED_TECH_SHIFT_OPEN_LABELS[current.open_trigger]}. {MED_TECH_SHIFT_CLOSE_LABELS[current.close_trigger]}.
          </p>
          <p className="text-xs text-muted-foreground">
            {current.facility_id ? "This facility's own rule" : "Organization default"} since {formatWhen(current.effective_from)}: {current.change_reason}
          </p>
        </div>
      ) : (
        <p className="text-sm" data-testid="med-tech-shift-rule-current">
          No rule is in force, so the time clock does not open or close cockpit shifts here.
        </p>
      )}

      {history.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">History</summary>
          <ul className="mt-2 space-y-1">
            {history.map((r) => (
              <li key={r.id}>
                {formatWhen(r.effective_from)} · {r.facility_id ? "this facility" : "organization"} · open: {r.open_trigger.replace("_", " ")}, close:{" "}
                {r.close_trigger.replace("_", " ")} — {r.change_reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canSetFacility ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3" aria-label="Change the med-tech shift rule">
          <div>
            <label htmlFor="mt-rule-scope" className={LABEL}>
              Applies to
            </label>
            <select id="mt-rule-scope" className={FIELD} value={draft.scope} required
              onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as Draft["scope"] }))}>
              <option value="">Choose scope</option>
              <option value="facility">{facilityName || "This facility"} only</option>
              {canSetOrganization ? <option value="organization">Organization default</option> : null}
            </select>
          </div>
          <div>
            <label htmlFor="mt-rule-open" className={LABEL}>
              Opens
            </label>
            <select id="mt-rule-open" className={FIELD} value={draft.open} required
              onChange={(e) => setDraft((d) => ({ ...d, open: e.target.value as Draft["open"] }))}>
              <option value="">Choose</option>
              <option value="clock_in">{MED_TECH_SHIFT_OPEN_LABELS.clock_in}</option>
              <option value="none">{MED_TECH_SHIFT_OPEN_LABELS.none}</option>
            </select>
          </div>
          <div>
            <label htmlFor="mt-rule-close" className={LABEL}>
              Closes
            </label>
            <select id="mt-rule-close" className={FIELD} value={draft.close} required
              onChange={(e) => setDraft((d) => ({ ...d, close: e.target.value as Draft["close"] }))}>
              <option value="">Choose</option>
              <option value="clock_out">{MED_TECH_SHIFT_CLOSE_LABELS.clock_out}</option>
              <option value="none">{MED_TECH_SHIFT_CLOSE_LABELS.none}</option>
            </select>
          </div>
          <div>
            <label htmlFor="mt-rule-effective" className={LABEL}>
              Takes effect
            </label>
            <input id="mt-rule-effective" type="datetime-local" className={FIELD} value={draft.effectiveFrom} required
              onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
          </div>
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="mt-rule-reason" className={LABEL}>
              Reason
            </label>
            <input id="mt-rule-reason" type="text" maxLength={500} className={`${FIELD} w-full`} value={draft.reason} required
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
          </div>
          <Button type="submit" size="sm"
            disabled={saving || !draft.scope || !draft.open || !draft.close || !draft.effectiveFrom || !draft.reason.trim()}>
            Save rule
          </Button>
          {saveError ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
