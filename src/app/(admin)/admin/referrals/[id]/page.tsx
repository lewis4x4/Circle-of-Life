"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";

type LeadDetail = Database["public"]["Tables"]["referral_leads"]["Row"] & {
  referral_sources: { name: string } | null;
  tour_scheduled_for: string | null;
  tour_completed_at: string | null;
  tour_owner_user_id: string | null;
};

type LeadUpdatePatch = Partial<Database["public"]["Tables"]["referral_leads"]["Update"]> & {
  tour_scheduled_for?: string | null;
  tour_completed_at?: string | null;
  tour_owner_user_id?: string | null;
};

type EditableLeadStatus = Exclude<Database["public"]["Enums"]["referral_lead_status"], "merged">;

const STATUS_OPTIONS: Array<{ value: EditableLeadStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "tour_scheduled", label: "Tour scheduled" },
  { value: "tour_completed", label: "Tour completed" },
  { value: "application_pending", label: "Application pending" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function formatTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminReferralLeadDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [linkedAdmissionCaseId, setLinkedAdmissionCaseId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<EditableLeadStatus>("new");
  const [notesDraft, setNotesDraft] = useState("");
  const [tourScheduledDraft, setTourScheduledDraft] = useState("");
  const [tourCompletedDraft, setTourCompletedDraft] = useState("");
  const [actionLoading, setActionLoading] = useState<"status" | "notes" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLead(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("referral_leads")
      .select(
        "*, referral_sources(name)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
      setLead(null);
      setLinkedAdmissionCaseId(null);
    } else {
      const leadRow = data as LeadDetail | null;
      setLead(leadRow);
      setStatusDraft((leadRow?.status as EditableLeadStatus | undefined) ?? "new");
      setNotesDraft(leadRow?.notes ?? "");
      setTourScheduledDraft(
        leadRow?.tour_scheduled_for ? new Date(leadRow.tour_scheduled_for).toISOString().slice(0, 16) : "",
      );
      setTourCompletedDraft(
        leadRow?.tour_completed_at ? new Date(leadRow.tour_completed_at).toISOString().slice(0, 16) : "",
      );
      if (leadRow) {
        const { data: admissionCase } = await supabase
          .from("admission_cases")
          .select("id")
          .eq("referral_lead_id", leadRow.id)
          .is("deleted_at", null)
          .not("status", "eq", "cancelled")
          .maybeSingle();
        setLinkedAdmissionCaseId(admissionCase?.id ?? null);
      } else {
        setLinkedAdmissionCaseId(null);
      }
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const wrongFacility =
    lead &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    lead.facility_id !== selectedFacilityId;

  const cannotSetConverted = Boolean(lead && !lead.converted_resident_id);

  async function updateLead(
    patch: LeadUpdatePatch,
    kind: "status" | "notes",
    successMessage: string,
  ) {
    if (!lead) return;
    setActionLoading(kind);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("referral_leads")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", lead.id);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update lead.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <Link href="/admin/referrals" className="hover:text-brand-600 dark:hover:text-brand-400">
              Referrals
            </Link>{" "}
            / Lead
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Lead detail
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Pipeline workspace for status, handoff, and prospect context.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linkedAdmissionCaseId ? (
            <Link href={`/admin/admissions/${linkedAdmissionCaseId}`} className={cn(buttonVariants({ size: "sm" }))}>
              Open admission case
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          ) : lead && !lead.converted_resident_id ? (
            <Link href={`/admin/admissions/new?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm" }))}>
              Start admission
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          ) : null}
          <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back to pipeline
          </Link>
        </div>
      </div>

      <ReferralsHubNav />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading lead…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : !lead ? (
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardContent className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            No lead found for this id, or you do not have access.
          </CardContent>
        </Card>
      ) : (
        <>
          {actionError ? (
            <p className="rounded-lg border border-red-200/80 bg-red-50/50 px-4 py-3 text-sm text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              {actionMessage}
            </p>
          ) : null}
          {wrongFacility ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              This lead belongs to another facility. Switch the facility in the header to{" "}
              <span className="font-mono text-xs">{lead.facility_id}</span> to align context.
            </p>
          ) : null}

          {linkedAdmissionCaseId ? (
            <p className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100">
              This lead already has an active admission case. Continue the workflow from that case instead of starting a duplicate handoff.
            </p>
          ) : null}

          <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">
                {lead.first_name} {lead.last_name}
                {lead.preferred_name ? (
                  <span className="ml-2 text-base font-normal text-slate-600 dark:text-slate-400">
                    (“{lead.preferred_name}”)
                  </span>
                ) : null}
              </CardTitle>
              <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-300">{lead.id}</p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <div className="rounded-lg border border-indigo-200/70 bg-indigo-50/60 px-4 py-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <label htmlFor="lead-status" className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Pipeline status
                    </label>
                    <select
                      id="lead-status"
                      value={statusDraft}
                      onChange={(event) => setStatusDraft(event.target.value as EditableLeadStatus)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={option.value === "converted" && cannotSetConverted}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {cannotSetConverted ? (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        `Converted` requires a linked resident conversion record. Use the admissions workflow first.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={actionLoading === "status" || statusDraft === lead.status}
                      onClick={() => void updateLead({ status: statusDraft }, "status", "Lead status saved.")}
                    >
                      {actionLoading === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save status"}
                    </Button>
                  </div>
                </div>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</dt>
                  <dd className="mt-0.5 capitalize text-slate-900 dark:text-slate-100">{formatStatus(lead.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">PII tier</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-900 dark:text-slate-100">{lead.pii_access_tier}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Referral source</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.referral_sources?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date of birth</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.date_of_birth ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Phone</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                  <dd className="mt-0.5 break-all text-slate-900 dark:text-slate-100">{lead.email ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Tour workflow</dt>
                  <dd className="mt-2 space-y-3 rounded-lg border border-slate-200/70 bg-slate-50/60 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Tour scheduled for</span>
                        <input
                          type="datetime-local"
                          value={tourScheduledDraft}
                          onChange={(event) => setTourScheduledDraft(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Tour completed at</span>
                        <input
                          type="datetime-local"
                          value={tourCompletedDraft}
                          onChange={(event) => setTourCompletedDraft(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={actionLoading === "status"}
                        onClick={() =>
                          void updateLead(
                            {
                              tour_scheduled_for: tourScheduledDraft ? new Date(tourScheduledDraft).toISOString() : null,
                              tour_completed_at: tourCompletedDraft ? new Date(tourCompletedDraft).toISOString() : null,
                              tour_owner_user_id: user?.id ?? null,
                            },
                            "status",
                            "Tour workflow saved.",
                          )
                        }
                      >
                        {actionLoading === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save tour details"}
                      </Button>
                    </div>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</dt>
                  <dd className="mt-2 space-y-3">
                    <textarea
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      rows={5}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={actionLoading === "notes" || notesDraft === (lead.notes ?? "")}
                        onClick={() => void updateLead({ notes: notesDraft.trim() || null }, "notes", "Lead notes saved.")}
                      >
                        {actionLoading === "notes" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save notes"}
                      </Button>
                    </div>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Converted resident</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-900 dark:text-slate-100">
                    {lead.converted_resident_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Converted at</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.converted_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Created</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Updated</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.updated_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
