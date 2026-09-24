"use client";

/**
 * Certification requirements per job role, and the "expiring soon" window
 * (COL-709, COL-710). Brian's ruling: admins choose which job roles need which
 * certifications; nobody is flagged for a role no one configured. Owners and
 * org admins set the organization default; facility admins set their
 * building's override. A change is a new effective-dated row with a reason,
 * never an edit, so history stays readable.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import {
  EXPIRING_SOON_DAYS_MAX,
  EXPIRING_SOON_DAYS_MIN,
  canSetFacilityCertificationRule,
  canSetOrganizationCertificationRule,
  insertCertificationRequirement,
  insertCertificationSettings,
  isValidExpiringSoonDays,
  loadCertificationRules,
  resolveCertificationPolicy,
  type CertificationRules,
} from "@/lib/staff/certification-policy";
import { CERT_TYPE_PRESETS, certificationTypeLabel } from "@/lib/staff/certification-types";
import { formatStaffRoleLabel } from "@/lib/staff/load-staff";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import { Constants } from "@/types/database";

const FIELD = "mt-1 block h-9 rounded-[8px] border border-border bg-background px-2 text-sm";
const LABEL = "text-xs font-medium text-muted-foreground";

const STAFF_ROLES = [...Constants.public.Enums.staff_role].sort((a, b) =>
  formatStaffRoleLabel(a).localeCompare(formatStaffRoleLabel(b)),
);

type Scope = "" | "facility" | "organization";

type RequirementDraft = {
  scope: Scope;
  staffRole: string;
  certificationType: string;
  required: "" | "yes" | "no";
  effectiveFrom: string;
  reason: string;
};
const EMPTY_REQUIREMENT: RequirementDraft = {
  scope: "",
  staffRole: "",
  certificationType: "",
  required: "",
  effectiveFrom: "",
  reason: "",
};

type WindowDraft = { scope: Scope; days: string; effectiveFrom: string; reason: string };
const EMPTY_WINDOW: WindowDraft = { scope: "", days: "", effectiveFrom: "", reason: "" };

export type CertificationRequirementsPanelProps = { now?: () => Date };

export function CertificationRequirementsPanel({ now = () => new Date() }: CertificationRequirementsPanelProps) {
  const { appRole, organizationId, user } = useHavenAuth();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const facilityName = availableFacilities.find((f) => f.id === facilityId)?.name ?? "This facility";

  const [rules, setRules] = useState<CertificationRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirement, setRequirement] = useState<RequirementDraft>(EMPTY_REQUIREMENT);
  const [windowDraft, setWindowDraft] = useState<WindowDraft>(EMPTY_WINDOW);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSetFacility = facilityId !== null && canSetFacilityCertificationRule(appRole);
  const canSetOrganization = canSetOrganizationCertificationRule(appRole);
  const canEdit = canSetFacility || canSetOrganization;

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    setError(null);
    try {
      const loaded = await loadCertificationRules(createClient());
      if (!isCurrent()) return;
      setRules(loaded);
    } catch (e) {
      if (!isCurrent()) return;
      setRules(null);
      setError(e instanceof Error ? e.message : "Could not load certification requirements.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const policy = useMemo(() => (rules ? resolveCertificationPolicy(rules, facilityId, now()) : null), [rules, facilityId, now]);
  const requiredRows = useMemo(
    () =>
      policy
        ? [...policy.requiredTypesByRole.entries()]
            .map(([role, types]) => ({ role, types: [...types].sort() }))
            .sort((a, b) => formatStaffRoleLabel(a.role).localeCompare(formatStaffRoleLabel(b.role)))
        : [],
    [policy],
  );
  const history = useMemo(
    () =>
      rules
        ? [
            ...rules.requirements.map((r) => ({
              id: r.id,
              when: r.effective_from,
              scope: r.facility_id,
              text: `${formatStaffRoleLabel(r.staff_role)} · ${certificationTypeLabel(r.certification_type)}: ${r.required ? "required" : "not required"}`,
              reason: r.change_reason,
            })),
            ...rules.settings.map((r) => ({
              id: r.id,
              when: r.effective_from,
              scope: r.facility_id,
              text: `Expiring soon: ${r.expiring_soon_days} days`,
              reason: r.change_reason,
            })),
          ]
            .filter((h) => h.scope === null || h.scope === facilityId)
            .sort((a, b) => Date.parse(b.when) - Date.parse(a.when))
            .slice(0, 20)
        : [],
    [rules, facilityId],
  );

  function effectiveOrError(value: string): Date | null {
    const effectiveFrom = new Date(value);
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() < now().getTime() - 60_000) {
      setSaveError("A change takes effect now or later; it cannot be backdated.");
      return null;
    }
    return effectiveFrom;
  }

  async function saveRequirement(event: React.FormEvent) {
    event.preventDefault();
    const d = requirement;
    if (!organizationId || !user || !d.scope || !d.staffRole || !d.certificationType || !d.required) return;
    const effectiveFrom = effectiveOrError(d.effectiveFrom);
    if (!effectiveFrom) return;
    setSaving(true);
    setSaveError(null);
    try {
      await insertCertificationRequirement(createClient(), {
        organizationId,
        facilityId: d.scope === "organization" ? null : facilityId,
        staffRole: d.staffRole,
        certificationType: d.certificationType,
        required: d.required === "yes",
        effectiveFrom,
        reason: d.reason,
        createdBy: user.id,
      });
      setRequirement(EMPTY_REQUIREMENT);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the requirement.");
    } finally {
      setSaving(false);
    }
  }

  async function saveWindow(event: React.FormEvent) {
    event.preventDefault();
    const d = windowDraft;
    const days = Number(d.days);
    if (!organizationId || !user || !d.scope || !d.effectiveFrom) return;
    if (!isValidExpiringSoonDays(days)) {
      setSaveError(`The window must be a whole number of days from ${EXPIRING_SOON_DAYS_MIN} to ${EXPIRING_SOON_DAYS_MAX}.`);
      return;
    }
    const effectiveFrom = effectiveOrError(d.effectiveFrom);
    if (!effectiveFrom) return;
    setSaving(true);
    setSaveError(null);
    try {
      await insertCertificationSettings(createClient(), {
        organizationId,
        facilityId: d.scope === "organization" ? null : facilityId,
        expiringSoonDays: days,
        effectiveFrom,
        reason: d.reason,
        createdBy: user.id,
      });
      setWindowDraft(EMPTY_WINDOW);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the window.");
    } finally {
      setSaving(false);
    }
  }

  const scopeOptions = (
    <>
      <option value="">Choose scope</option>
      {canSetFacility ? <option value="facility">{facilityName} only</option> : null}
      {canSetOrganization ? <option value="organization">Organization default</option> : null}
    </>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Certification requirements</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Which job roles need which certifications{facilityId ? ` at ${facilityName}` : " across the organization"}, and how
          early a certification reads &ldquo;expiring soon&rdquo;. Staff in a role with no requirement are never flagged.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : !policy ? (
        <p className="text-sm text-muted-foreground">Loading certification requirements…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="cert-req-heading">
            <h2 id="cert-req-heading" className="text-sm font-semibold">
              Required certifications by job role
            </h2>
            {!policy.configured ? (
              <p className="text-sm" data-testid="cert-requirements-current">
                Certification requirements are not set up, so the roster and staffing console flag nobody.
              </p>
            ) : requiredRows.length === 0 ? (
              <p className="text-sm" data-testid="cert-requirements-current">
                No job role needs a certification here.
              </p>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="cert-requirements-current">
                {requiredRows.map((row) => (
                  <li key={row.role}>
                    <span className="font-medium">{formatStaffRoleLabel(row.role)}</span>:{" "}
                    {row.types.map(certificationTypeLabel).join(", ")}
                  </li>
                ))}
              </ul>
            )}

            {canEdit ? (
              <form onSubmit={saveRequirement} className="flex flex-wrap items-end gap-3" aria-label="Change a certification requirement">
                <div>
                  <label htmlFor="cert-req-scope" className={LABEL}>
                    Applies to
                  </label>
                  <select id="cert-req-scope" className={FIELD} value={requirement.scope} required
                    onChange={(e) => setRequirement((d) => ({ ...d, scope: e.target.value as Scope }))}>
                    {scopeOptions}
                  </select>
                </div>
                <div>
                  <label htmlFor="cert-req-role" className={LABEL}>
                    Job role
                  </label>
                  <select id="cert-req-role" className={FIELD} value={requirement.staffRole} required
                    onChange={(e) => setRequirement((d) => ({ ...d, staffRole: e.target.value }))}>
                    <option value="">Choose role</option>
                    {STAFF_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {formatStaffRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cert-req-type" className={LABEL}>
                    Certification
                  </label>
                  <select id="cert-req-type" className={FIELD} value={requirement.certificationType} required
                    onChange={(e) => setRequirement((d) => ({ ...d, certificationType: e.target.value }))}>
                    <option value="">Choose certification</option>
                    {CERT_TYPE_PRESETS.filter((t) => t.value !== "other").map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cert-req-required" className={LABEL}>
                    Requirement
                  </label>
                  <select id="cert-req-required" className={FIELD} value={requirement.required} required
                    onChange={(e) => setRequirement((d) => ({ ...d, required: e.target.value as RequirementDraft["required"] }))}>
                    <option value="">Choose</option>
                    <option value="yes">Required</option>
                    <option value="no">Not required</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cert-req-effective" className={LABEL}>
                    Takes effect
                  </label>
                  <input id="cert-req-effective" type="datetime-local" className={FIELD} value={requirement.effectiveFrom} required
                    onChange={(e) => setRequirement((d) => ({ ...d, effectiveFrom: e.target.value }))} />
                </div>
                <div className="min-w-[16rem] flex-1">
                  <label htmlFor="cert-req-reason" className={LABEL}>
                    Reason
                  </label>
                  <input id="cert-req-reason" type="text" maxLength={500} className={`${FIELD} w-full`} value={requirement.reason} required
                    onChange={(e) => setRequirement((d) => ({ ...d, reason: e.target.value }))} />
                </div>
                <Button type="submit" size="sm"
                  disabled={
                    saving ||
                    !requirement.scope ||
                    !requirement.staffRole ||
                    !requirement.certificationType ||
                    !requirement.required ||
                    !requirement.effectiveFrom ||
                    !requirement.reason.trim()
                  }>
                  Save requirement
                </Button>
              </form>
            ) : null}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="cert-window-heading">
            <h2 id="cert-window-heading" className="text-sm font-semibold">
              Expiring soon
            </h2>
            <p className="text-sm" data-testid="cert-window-current">
              {policy.expiringSoonDays === null
                ? "No window is set, so no certification reads as expiring soon."
                : `A certification reads "expiring soon" ${policy.expiringSoonDays} days before it expires.`}
            </p>
            {canEdit ? (
              <form onSubmit={saveWindow} className="flex flex-wrap items-end gap-3" aria-label="Change the expiring-soon window">
                <div>
                  <label htmlFor="cert-window-scope" className={LABEL}>
                    Applies to
                  </label>
                  <select id="cert-window-scope" className={FIELD} value={windowDraft.scope} required
                    onChange={(e) => setWindowDraft((d) => ({ ...d, scope: e.target.value as Scope }))}>
                    {scopeOptions}
                  </select>
                </div>
                <div>
                  <label htmlFor="cert-window-days" className={LABEL}>
                    Days before expiry ({EXPIRING_SOON_DAYS_MIN}–{EXPIRING_SOON_DAYS_MAX})
                  </label>
                  <input id="cert-window-days" type="number" inputMode="numeric" min={EXPIRING_SOON_DAYS_MIN} max={EXPIRING_SOON_DAYS_MAX}
                    step={1} className={FIELD} value={windowDraft.days} required
                    onChange={(e) => setWindowDraft((d) => ({ ...d, days: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="cert-window-effective" className={LABEL}>
                    Takes effect
                  </label>
                  <input id="cert-window-effective" type="datetime-local" className={FIELD} value={windowDraft.effectiveFrom} required
                    onChange={(e) => setWindowDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
                </div>
                <div className="min-w-[16rem] flex-1">
                  <label htmlFor="cert-window-reason" className={LABEL}>
                    Reason
                  </label>
                  <input id="cert-window-reason" type="text" maxLength={500} className={`${FIELD} w-full`} value={windowDraft.reason} required
                    onChange={(e) => setWindowDraft((d) => ({ ...d, reason: e.target.value }))} />
                </div>
                <Button type="submit" size="sm"
                  disabled={saving || !windowDraft.scope || !windowDraft.days || !windowDraft.effectiveFrom || !windowDraft.reason.trim()}>
                  Save window
                </Button>
              </form>
            ) : null}
          </section>

          {saveError ? (
            <p className="text-sm text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}

          {!canEdit ? (
            <p className="text-xs text-muted-foreground">
              Owners and org admins set the organization default; facility admins set their building&apos;s override.
            </p>
          ) : null}

          {history.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">History</summary>
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    {formatDisplayDateTime(h.when)} · {h.scope ? facilityName : "organization"} · {h.text} — {h.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
