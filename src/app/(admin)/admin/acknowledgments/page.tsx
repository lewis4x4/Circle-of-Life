"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, Loader2, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  ACK_ROLES,
  outstandingForRequirement,
  roleLabel,
  type AcknowledgmentRow,
  type AckRequirementRow,
  type QueryError,
  type QueryResult,
  type StaffProfileMini,
} from "@/lib/office/acknowledgments";
import { fetchActorContext } from "@/lib/office/meetings";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type PublishedDoc = { id: string; title: string };

export default function AdminAcknowledgmentsDashboardPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [requirements, setRequirements] = useState<AckRequirementRow[]>([]);
  const [acks, setAcks] = useState<AcknowledgmentRow[]>([]);
  const [staff, setStaff] = useState<StaffProfileMini[]>([]);
  const [publishedDocs, setPublishedDocs] = useState<PublishedDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [docId, setDocId] = useState("");
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [requireSignature, setRequireSignature] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const requirementsQ = supabase
        .from("document_acknowledgment_requirements" as never)
        .select(
          "id, document_id, document_title, required_roles, require_signature, due_date, note, is_active, created_at",
        )
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      const acksQ = supabase
        .from("document_acknowledgments" as never)
        .select("id, requirement_id, document_id, user_id, signature_name, signer_role, acknowledged_at")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .limit(2000);
      const accessRows = await readAllPages((from, to) => supabase.from("user_facility_access").select("user_id", { count: "exact" }).eq("facility_id", selectedFacilityId as string).is("revoked_at", null).order("user_id").range(from, to));
      const staffQ = supabase
        .from("user_profiles")
        .select("id, full_name, app_role, is_active")
        .in("id", accessRows.data.map((access) => access.user_id))
        .is("deleted_at", null)
        .eq("is_active", true);
      const docsQ = supabase
        .from("documents" as never)
        .select("id, title")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("title")
        .limit(500);

      const [reqRes, ackRes, staffRes, docRes] = await Promise.all([
        requirementsQ as unknown as Promise<QueryResult<AckRequirementRow>>,
        acksQ as unknown as Promise<QueryResult<AcknowledgmentRow>>,
        staffQ as unknown as Promise<QueryResult<StaffProfileMini>>,
        docsQ as unknown as Promise<QueryResult<PublishedDoc>>,
      ]);
      const err: QueryError | null =
        reqRes.error ?? ackRes.error ?? staffRes.error ?? docRes.error;
      if (err) throw new Error(err.message);
      setRequirements(reqRes.data ?? []);
      setAcks(ackRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setPublishedDocs(docRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load acknowledgments.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRole = useCallback((role: string) => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const createRequirement = useCallback(async () => {
    if (!facilityReady || !docId || roles.size === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const doc = publishedDocs.find((d) => d.id === docId);
      if (!doc) throw new Error("Pick a published document.");
      const { error } = await supabase
        .from("document_acknowledgment_requirements" as never)
        .insert({
          organization_id: actor.organizationId,
          facility_id: selectedFacilityId as string,
          document_id: doc.id,
          document_title: doc.title,
          required_roles: Array.from(roles),
          require_signature: requireSignature,
          due_date: dueDate || null,
          note: note.trim() || null,
          created_by: actor.userId,
          updated_by: actor.userId,
        } as never);
      if (error) throw new Error(error.message);
      setDocId("");
      setRoles(new Set());
      setDueDate("");
      setNote("");
      setShowForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to create the requirement.");
    } finally {
      setSaving(false);
    }
  }, [
    supabase,
    facilityReady,
    docId,
    roles,
    requireSignature,
    dueDate,
    note,
    publishedDocs,
    selectedFacilityId,
    load,
  ]);

  const totals = useMemo(() => {
    let outstanding = 0;
    for (const r of requirements.filter((r) => r.is_active)) {
      outstanding += outstandingForRequirement(r, staff, acks).length;
    }
    return { outstanding, signatures: acks.length };
  }, [requirements, staff, acks]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <FileCheck2 className="h-8 w-8 text-info shrink-0" aria-hidden />
              Policy acknowledgments
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Read-and-sign requirements on published policies, SOPs, and handbook documents.
              Typed-name e-signatures are immutable survey evidence.
              {totals.outstanding > 0
                ? ` ${totals.outstanding} outstanding signature${totals.outstanding === 1 ? "" : "s"}.`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/admin/acknowledgments/my"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "gap-2 font-medium text-[10px] uppercase tracking-wider",
              )}
            >
              My acknowledgments
            </Link>
            <Button
              type="button"
              className="gap-2 font-medium text-[10px] uppercase tracking-wider"
              onClick={() => setShowForm((v) => !v)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {showForm ? "Close" : "New requirement"}
            </Button>
          </div>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — requirements are tracked per facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady && showForm ? (
          <section
            aria-labelledby="ack-form-heading"
            className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-4"
          >
            <h3 id="ack-form-heading" className="text-lg font-semibold text-foreground">
              New acknowledgment requirement
            </h3>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Published document (KB)
                </span>
                <select
                  value={docId}
                  onChange={(e) => setDocId(e.target.value)}
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a published document…</option>
                  {publishedDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Due date (optional)
                </span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Required roles
              </legend>
              <div className="flex flex-wrap gap-2">
                {ACK_ROLES.map((r) => {
                  const active = roles.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleRole(r.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground border border-border hover:bg-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={requireSignature}
                  onChange={(e) => setRequireSignature(e.target.checked)}
                />
                Require typed-name e-signature (unchecked = mark as read)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note shown to staff (optional)"
                aria-label="Note shown to staff"
                className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <Button
              type="button"
              disabled={saving || !docId || roles.size === 0}
              onClick={() => void createRequirement()}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create requirement
            </Button>
          </section>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <section aria-labelledby="ack-requirements-heading" className="space-y-3">
            <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="ack-requirements-heading" className="text-lg font-semibold text-foreground">
                Requirements
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {requirements.length}
                </span>
              </h3>
            </div>
            {requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">
                No acknowledgment requirements yet — create one against a published KB document.
              </p>
            ) : (
              <ul className="space-y-2">
                {requirements.map((r) => {
                  const reqAcks = acks.filter((a) => a.requirement_id === r.id);
                  const outstanding = outstandingForRequirement(r, staff, acks);
                  const expanded = expandedId === r.id;
                  return (
                    <li key={r.id} className="rounded-[9px] border border-border bg-card px-[13px] py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        aria-expanded={expanded}
                        className="flex w-full flex-col gap-2 text-left lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-semibold text-foreground truncate">
                            {r.document_title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {r.required_roles.map(roleLabel).join(", ")}
                            {r.due_date ? ` · due ${r.due_date}` : ""}
                            {r.require_signature ? " · e-signature" : " · mark as read"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill tone={outstanding.length > 0 ? "warning" : "success"}>
                            {reqAcks.length} signed · {outstanding.length} outstanding
                          </StatusPill>
                          {!r.is_active ? <StatusPill tone="muted">inactive</StatusPill> : null}
                        </div>
                      </button>
                      {expanded ? (
                        <div className="mt-3 grid gap-4 border-t border-border pt-3 lg:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                              Signed ({reqAcks.length})
                            </p>
                            {reqAcks.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No signatures yet.</p>
                            ) : (
                              <ul className="space-y-1">
                                {reqAcks.map((a) => (
                                  <li key={a.id} className="text-sm text-foreground">
                                    {a.signature_name}{" "}
                                    <span className="text-xs text-muted-foreground">
                                      ({roleLabel(a.signer_role)}) ·{" "}
                                      {ET_FMT.format(new Date(a.acknowledged_at))} ET
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                              Outstanding ({outstanding.length})
                            </p>
                            {outstanding.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                Everyone in the required roles has signed.
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {outstanding.map((s) => (
                                  <li key={s.id} className="text-sm text-foreground">
                                    {s.full_name}{" "}
                                    <span className="text-xs text-muted-foreground">
                                      ({roleLabel(s.app_role)})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <p className="lg:col-span-2 text-xs text-muted-foreground">
                            <Link
                              href={`/admin/knowledge/documents/${r.document_id}`}
                              className="underline"
                            >
                              View the published document
                            </Link>
                            {r.note ? ` · ${r.note}` : ""}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
