"use client";

/**
 * COL-740: which P&P manuals each job role signs at onboarding, and who has
 * signed. Brian's ruling (2026-09-24): onboarding only; existing staff are
 * never flagged and nobody re-signs. A rule reaches only staff whose hire date
 * falls on or after it takes effect. Owners and org admins set the
 * organization default; facility admins set their building's override. A
 * change is a new effective-dated row with a reason, never an edit.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { Button } from "@/components/ui/button";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { knowledgeBasePolicyDocuments, type KnowledgeBaseDocumentSummary } from "@/lib/compliance/knowledge-base-policies";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import { canSetFacilityCertificationRule, canSetOrganizationCertificationRule } from "@/lib/staff/certification-policy";
import { formatStaffRoleLabel } from "@/lib/staff/load-staff";
import {
  insertOnboardingManualRules,
  loadOnboardingManualRules,
  resolveOnboardingManualPolicy,
  type OnboardingManualOverviewRow,
  type OnboardingManualRule,
} from "@/lib/staff/onboarding-manuals";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import { Constants } from "@/types/database";

const FIELD = "mt-1 block h-9 rounded-[8px] border border-border bg-background px-2 text-sm";
const LABEL = "text-xs font-medium text-muted-foreground";

const STAFF_ROLES = [...Constants.public.Enums.staff_role].sort((a, b) =>
  formatStaffRoleLabel(a).localeCompare(formatStaffRoleLabel(b)),
);

type Scope = "" | "facility" | "organization";
type Draft = { scope: Scope; roles: string[]; documentId: string; required: "" | "yes" | "no"; effectiveFrom: string; reason: string };
const EMPTY: Draft = { scope: "", roles: [], documentId: "", required: "", effectiveFrom: "", reason: "" };

type Overview = { state: "no_facility" } | { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rows: OnboardingManualOverviewRow[] };

export function OnboardingManualsSettings({ now = () => new Date() }: { now?: () => Date }) {
  const { appRole, organizationId, user } = useHavenAuth();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const facilityName = availableFacilities.find((f) => f.id === facilityId)?.name ?? "This facility";

  const [rules, setRules] = useState<OnboardingManualRule[] | null>(null);
  const [manuals, setManuals] = useState<KnowledgeBaseDocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>({ state: "no_facility" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSetFacility = facilityId !== null && canSetFacilityCertificationRule(appRole);
  const canSetOrganization = canSetOrganizationCertificationRule(appRole);
  const canEdit = canSetFacility || canSetOrganization;

  const load = useCallback(async () => {
    setError(null);
    try {
      const client = createClient();
      const [loadedRules, docs] = await Promise.all([
        loadOnboardingManualRules(client),
        client.from("documents").select("id, title, doc_type, status, word_count").eq("status", "published").is("deleted_at", null).limit(500),
      ]);
      if (docs.error) throw new Error(docs.error.message);
      setRules(loadedRules);
      // doc_type exists on hosted documents but is missing from the generated types.
      setManuals(knowledgeBasePolicyDocuments((docs.data ?? []) as unknown as KnowledgeBaseDocumentSummary[]));
    } catch (e) {
      setRules(null);
      setManuals(null);
      setError(e instanceof Error ? e.message : "Could not load onboarding manual settings.");
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!facilityId) {
      setOverview({ state: "no_facility" });
      return;
    }
    setOverview({ state: "loading" });
    const { data, error: rpcError } = await createClient().rpc("haven_onboarding_manual_overview" as never, { p_facility_id: facilityId } as never);
    setOverview(rpcError ? { state: "error", message: "Who has signed could not be loaded." } : { state: "ready", rows: (data ?? []) as OnboardingManualOverviewRow[] });
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const titleById = useMemo(() => new Map((manuals ?? []).map((m) => [m.id, m.title])), [manuals]);
  const policy = useMemo(() => (rules ? resolveOnboardingManualPolicy(rules, facilityId, now()) : null), [rules, facilityId, now]);
  const inForceRows = useMemo(
    () =>
      policy
        ? [...policy.manualsByRole.entries()]
            .map(([role, ids]) => ({ role, titles: [...ids].map((id) => titleById.get(id) ?? "A manual no longer published").sort() }))
            .sort((a, b) => formatStaffRoleLabel(a.role).localeCompare(formatStaffRoleLabel(b.role)))
        : [],
    [policy, titleById],
  );
  const history = useMemo(
    () =>
      (rules ?? [])
        .filter((r) => r.facility_id === null || r.facility_id === facilityId)
        .slice(0, 30),
    [rules, facilityId],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationId || !user || !draft.scope || draft.roles.length === 0 || !draft.documentId || !draft.required) return;
    const effectiveFrom = new Date(draft.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() < now().getTime() - 60_000) {
      setSaveError("A change takes effect now or later; it cannot be backdated.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await insertOnboardingManualRules(createClient(), {
        organizationId,
        facilityId: draft.scope === "facility" ? facilityId : null,
        staffRoles: draft.roles,
        documentId: draft.documentId,
        required: draft.required === "yes",
        effectiveFrom,
        reason: draft.reason,
        createdBy: user.id,
      });
      setDraft(EMPTY);
      await Promise.all([load(), loadOverview()]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Onboarding manual sign-off</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Which knowledge-base P&amp;P manuals a new hire signs, as read and understood, during onboarding
          {facilityId ? ` at ${facilityName}` : " across the organization"}. A rule applies only to staff hired on or after the
          day it takes effect: existing staff are never asked, and nobody signs the same manual twice.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : !policy || !manuals ? (
        <p className="text-sm text-muted-foreground">Loading onboarding manual settings…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="om-current-heading">
            <h2 id="om-current-heading" className="text-sm font-semibold">Manuals each job role signs, for someone hired today</h2>
            {!policy.configured ? (
              <p className="text-sm" data-testid="onboarding-manuals-current">
                Not set up. No new hire is asked to sign a manual until a rule is recorded here.
              </p>
            ) : inForceRows.length === 0 ? (
              <p className="text-sm" data-testid="onboarding-manuals-current">No job role signs a manual at onboarding here.</p>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="onboarding-manuals-current">
                {inForceRows.map((row) => (
                  <li key={row.role}>
                    <span className="font-medium">{formatStaffRoleLabel(row.role)}</span>: {row.titles.join(", ")}
                  </li>
                ))}
              </ul>
            )}

            {canEdit ? (
              <form onSubmit={save} className="space-y-3" aria-label="Change an onboarding manual requirement">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor="om-scope" className={LABEL}>Applies to</label>
                    <select id="om-scope" className={FIELD} value={draft.scope} required onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as Scope }))}>
                      <option value="">Choose scope</option>
                      {canSetFacility ? <option value="facility">{facilityName} only</option> : null}
                      {canSetOrganization ? <option value="organization">Organization default</option> : null}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="om-manual" className={LABEL}>Manual</label>
                    <select id="om-manual" className={FIELD} value={draft.documentId} required onChange={(e) => setDraft((d) => ({ ...d, documentId: e.target.value }))}>
                      <option value="">Choose manual</option>
                      {manuals.map((m) => (
                        <option key={m.id} value={m.id}>{m.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="om-required" className={LABEL}>Sign at onboarding</label>
                    <select id="om-required" className={FIELD} value={draft.required} required onChange={(e) => setDraft((d) => ({ ...d, required: e.target.value as Draft["required"] }))}>
                      <option value="">Choose</option>
                      <option value="yes">Required</option>
                      <option value="no">Not required</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="om-effective" className={LABEL}>Takes effect</label>
                    <input id="om-effective" type="datetime-local" className={FIELD} value={draft.effectiveFrom} required onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
                  </div>
                  <div className="min-w-[16rem] flex-1">
                    <label htmlFor="om-reason" className={LABEL}>Reason</label>
                    <input id="om-reason" className={`${FIELD} w-full`} value={draft.reason} required maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
                  </div>
                </div>
                <fieldset>
                  <legend className={LABEL}>Job roles</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {STAFF_ROLES.map((role) => (
                      <label key={role} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.roles.includes(role)}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, roles: e.target.checked ? [...d.roles, role] : d.roles.filter((r) => r !== role) }))
                          }
                        />
                        {formatStaffRoleLabel(role)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {saveError ? <p className="text-sm text-destructive" role="alert">{saveError}</p> : null}
                <Button type="submit" disabled={saving || draft.roles.length === 0}>{saving ? "Saving…" : "Record change"}</Button>
              </form>
            ) : (
              <p className="text-[13px] text-muted-foreground">Owners, org admins and facility administrators can change these rules.</p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="om-signed-heading">
            <h2 id="om-signed-heading" className="text-sm font-semibold">Who has signed{facilityId ? ` at ${facilityName}` : ""}</h2>
            {overview.state === "no_facility" ? (
              <FacilityGateNotice reason="Sign-offs are recorded per building, so the list of new hires opens for one facility at a time." />
            ) : overview.state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : overview.state === "error" ? (
              <p className="text-sm text-destructive" role="alert">{overview.message}</p>
            ) : overview.rows.length === 0 ? (
              <p className="text-sm">No one here owes a manual sign-off. Only staff hired after a rule took effect appear.</p>
            ) : (
              <HorizontalScroll label="New hires and their manual sign-offs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Employee</th>
                    <th className="py-1 font-medium">Job role</th>
                    <th className="py-1 font-medium">Hired</th>
                    <th className="py-1 font-medium">Signed</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => (
                    <tr key={row.staff_id} className="border-t">
                      <td className="py-1.5">
                        <Link className="underline" href={`/admin/staff/${row.staff_id}/employee-file`}>
                          {row.first_name} {row.last_name}
                        </Link>
                      </td>
                      <td className="py-1.5">{formatStaffRoleLabel(row.staff_role)}</td>
                      <td className="py-1.5">{row.hire_date}</td>
                      <td className="py-1.5">
                        {row.signed_count === row.required_count
                          ? `All ${row.required_count} signed`
                          : `${row.signed_count} of ${row.required_count} — onboarding not complete`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </HorizontalScroll>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-labelledby="om-history-heading">
            <h2 id="om-history-heading" className="text-sm font-semibold">History</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {history.map((r) => (
                  <li key={r.id}>
                    {formatDisplayDateTime(r.effective_from)} · {r.facility_id ? facilityName : "Organization"} ·{" "}
                    {formatStaffRoleLabel(r.staff_role)} · {titleById.get(r.document_id) ?? "A manual no longer published"}:{" "}
                    {r.required ? "required" : "not required"} — {r.change_reason}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
