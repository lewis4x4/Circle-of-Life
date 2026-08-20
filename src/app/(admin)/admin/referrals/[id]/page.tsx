"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants, Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { formatAdmissionsHubReferralSource } from "@/lib/admissions/admissions-hub-display-copy";
import {
  formatReferralDetailConvertedResidentId,
  formatReferralDetailDateOfBirth,
  formatReferralDetailEmail,
  formatReferralDetailPhone,
  formatReferralDetailTimestamp,
} from "@/lib/admissions/referral-detail-display-copy";
import {
  facilityDatetimeLocalToUtcIso,
  utcIsoToFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";

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

function syncTourStatus(
  currentStatus: EditableLeadStatus,
  scheduledIso: string | null,
  completedIso: string | null,
): EditableLeadStatus {
  if (["application_pending", "waitlisted", "converted", "lost"].includes(currentStatus)) {
    return currentStatus;
  }
  if (completedIso) return "tour_completed";
  if (scheduledIso) return currentStatus === "new" ? "tour_scheduled" : currentStatus === "contacted" ? "tour_scheduled" : currentStatus;
  return currentStatus;
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
        leadRow?.tour_scheduled_for ? utcIsoToFacilityDatetimeLocal(leadRow.tour_scheduled_for) : "",
      );
      setTourCompletedDraft(
        leadRow?.tour_completed_at ? utcIsoToFacilityDatetimeLocal(leadRow.tour_completed_at) : "",
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

  const leadActions = lead ? (
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
  ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <RecordDetailHeader
        title="Lead detail"
        subtitle="Pipeline workspace for status, handoff, and prospect context."
        backLink={{ label: "Referrals", href: "/admin/referrals" }}
        actions={leadActions}
      />

      <ReferralsHubNav />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading lead…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : !lead ? (
        <div className="rounded-[8px] border border-border bg-card p-[14px]">
          <p className="py-8 text-center text-sm text-muted-foreground">
            No lead found for this id, or you do not have access.
          </p>
        </div>
      ) : (
        <>
          {actionError ? (
            <p className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              {actionMessage}
            </p>
          ) : null}
          {wrongFacility ? (
            <p className="rounded-[8px] border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
              This lead belongs to another facility. Switch the facility in the header to{" "}
              <span className="font-mono text-xs">{lead.facility_id}</span> to align context.
            </p>
          ) : null}

          {linkedAdmissionCaseId ? (
            <p className="rounded-[8px] border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">
              This lead already has an active admission case. Continue the workflow from that case instead of starting a duplicate handoff.
            </p>
          ) : null}

          <RecordDetailSection title="Lead identity">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xl font-semibold text-foreground">
                  {lead.first_name} {lead.last_name}
                  {lead.preferred_name ? (
                    <span className="ml-2 text-base font-normal text-muted-foreground">
                      (&ldquo;{lead.preferred_name}&rdquo;)
                    </span>
                  ) : null}
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground mt-1">{lead.id}</p>
              </div>

              <div className="rounded-[8px] border border-border bg-muted/10 px-4 py-4">
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <label htmlFor="lead-status" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pipeline status
                    </label>
                    <select
                      id="lead-status"
                      value={statusDraft}
                      onChange={(event) => setStatusDraft(event.target.value as EditableLeadStatus)}
                      className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                      <p className="text-xs text-warning">
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
                  <dd className="mt-0.5 capitalize text-foreground">{formatStatus(lead.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PII tier</dt>
                  <dd className="mt-0.5 text-xs text-foreground">{lead.pii_access_tier}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Referral source</dt>
                  <dd className="mt-0.5 text-foreground">
                    {formatAdmissionsHubReferralSource(lead.referral_sources?.name)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date of birth</dt>
                  <dd className="mt-0.5 text-foreground">
                    {formatReferralDetailDateOfBirth(lead.date_of_birth)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</dt>
                  <dd className="mt-0.5 text-foreground">{formatReferralDetailPhone(lead.phone)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                  <dd className="mt-0.5 break-all text-foreground">
                    {formatReferralDetailEmail(lead.email)}
                  </dd>
                </div>
              </dl>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Tour workflow">
            <div className="space-y-4 text-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tour scheduled for (ET)</span>
                  <input
                    type="datetime-local"
                    value={tourScheduledDraft}
                    onChange={(event) => setTourScheduledDraft(event.target.value)}
                    aria-label="Tour scheduled for (Eastern Time)"
                    className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tour completed at (ET)</span>
                  <input
                    type="datetime-local"
                    value={tourCompletedDraft}
                    onChange={(event) => setTourCompletedDraft(event.target.value)}
                    aria-label="Tour completed at (Eastern Time)"
                    className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionLoading === "status"}
                  onClick={() =>
                    void (() => {
                      const scheduledIso = tourScheduledDraft
                        ? facilityDatetimeLocalToUtcIso(tourScheduledDraft)
                        : null;
                      const completedIso = tourCompletedDraft
                        ? facilityDatetimeLocalToUtcIso(tourCompletedDraft)
                        : null;
                      const nextStatus = syncTourStatus(statusDraft, scheduledIso, completedIso);
                      return updateLead(
                        {
                          status: nextStatus,
                          tour_scheduled_for: scheduledIso,
                          tour_completed_at: completedIso,
                          tour_owner_user_id: user?.id ?? null,
                        },
                        "status",
                        nextStatus === statusDraft ? "Tour workflow saved." : `Tour workflow saved and status moved to ${formatStatus(nextStatus)}.`,
                      );
                    })()
                  }
                >
                  {actionLoading === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save tour details"}
                </Button>
              </div>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Notes">
            <div className="space-y-3">
              <textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={5}
                className="w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Conversion">
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Converted resident</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">
                  {formatReferralDetailConvertedResidentId(lead.converted_resident_id)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Converted at</dt>
                <dd className="mt-0.5 text-foreground">
                  {formatReferralDetailTimestamp(lead.converted_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</dt>
                <dd className="mt-0.5 text-foreground">
                  {formatReferralDetailTimestamp(lead.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</dt>
                <dd className="mt-0.5 text-foreground">
                  {formatReferralDetailTimestamp(lead.updated_at)}
                </dd>
              </div>
            </dl>
          </RecordDetailSection>
        </>
      )}
    </div>
  );
}
