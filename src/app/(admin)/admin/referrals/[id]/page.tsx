"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { buttonVariants, Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
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
  loadAuthorizedReferralLeads,
  loadReferralEpisodeModel,
  updateAuthorizedReferralLead,
  type AuthorizedReferralLeadRow,
  type ReferralEpisodeModel,
  type ReferralLeadUpdatePatch,
} from "@/lib/referrals/referral-authority";
import { enumLabel } from "@/lib/display/enum-label";
import { ReferralContactLog } from "@/components/referrals/ReferralContactLog";
import { ReferralTours } from "@/components/referrals/ReferralTours";

type LeadDetail = AuthorizedReferralLeadRow;

type LeadContact = ReferralEpisodeModel["contacts"][number];

type ContactsState =
  | { status: "loading" }
  | { status: "loaded"; contacts: LeadContact[]; episode: ReferralEpisodeModel["episode"] | null }
  | { status: "failed"; message: string };

function currentPersonContacts(model: ReferralEpisodeModel): LeadContact[] {
  return model.contacts.filter((contact) => contact.belongs_to_current_person);
}

const CHANNEL_LABEL: Record<LeadContact["permissions"][number]["channel"], string> = {
  phone: "Phone",
  sms: "Text",
  email: "Email",
};

/** Permissions are recorded per channel; an unrecorded one is said so, never implied. */
function permissionSummary(contact: LeadContact): string {
  const recorded = contact.permissions.filter((permission) => permission.permission_state !== "unknown");
  if (recorded.length === 0) return "Contact permissions not recorded.";
  return recorded
    .map((permission) => `${CHANNEL_LABEL[permission.channel]}: ${permission.permission_state === "permitted" ? "permitted" : "declined"}`)
    .join(" · ");
}

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
  return enumLabel(s);
}

export default function AdminReferralLeadDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [linkedAdmissionCaseId, setLinkedAdmissionCaseId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<EditableLeadStatus>("new");
  const [actionLoading, setActionLoading] = useState<"status" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [contactsState, setContactsState] = useState<ContactsState>({ status: "loading" });
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!id) {
      setLead(null);
      setLoading(false);
      return;
    }
    // A save elsewhere on the page re-reads quietly so the contact log keeps its unsaved entry.
    if (!options.quiet) setLoading(true);
    setError(null);
    try {
      const [leadRow = null] = await loadAuthorizedReferralLeads(supabase, {
        leadId: id,
        limit: 1,
      });
      setLead(leadRow);
      setStatusDraft((leadRow?.status as EditableLeadStatus | undefined) ?? "new");
      if (leadRow) {
        const { data: admissionCase } = await supabase
          .from("admission_cases")
          .select("id")
          .eq("referral_lead_id", leadRow.id)
          .is("deleted_at", null)
          .not("status", "eq", "cancelled")
          .maybeSingle();
        setLinkedAdmissionCaseId(admissionCase?.id ?? null);
        // Linked contacts live behind their own read boundary; a failure here
        // must not take the lead itself off the page.
        try {
          const model = await loadReferralEpisodeModel(supabase, leadRow.id);
          setContactsState({
            status: "loaded",
            contacts: currentPersonContacts(model),
            episode: model.episode ?? null,
          });
        } catch (contactsError) {
          setContactsState({
            status: "failed",
            message: contactsError instanceof Error ? contactsError.message : "Contacts could not be read.",
          });
        }
      } else {
        setLinkedAdmissionCaseId(null);
        setContactsState({ status: "loaded", contacts: [], episode: null });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load lead.");
      setLead(null);
      setLinkedAdmissionCaseId(null);
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  /** Re-read the episode quietly after a contact-log save; the page itself stays put. */
  const refreshEpisode = useCallback(async () => {
    if (!id) return;
    try {
      const model = await loadReferralEpisodeModel(supabase, id);
      setContactsState({
        status: "loaded",
        contacts: currentPersonContacts(model),
        episode: model.episode ?? null,
      });
    } catch (refreshError) {
      setContactsState({
        status: "failed",
        message: refreshError instanceof Error ? refreshError.message : "Contacts could not be read.",
      });
    }
  }, [supabase, id]);

  /** A tour save can move the lead status and adds to the history; the contact log keeps its entry. */
  const handleToursChanged = useCallback(async () => {
    await load({ quiet: true });
    setHistoryRefreshKey((current) => current + 1);
  }, [load]);

  const wrongFacility =
    lead &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    lead.facility_id !== selectedFacilityId;

  const canEditLead = Boolean(lead?.can_write);

  async function updateLead(
    patch: ReferralLeadUpdatePatch,
    kind: "status",
    successMessage: string,
  ) {
    if (!lead) return;
    setActionLoading(kind);
    setActionError(null);
    setActionMessage(null);
    try {
      await updateAuthorizedReferralLead(supabase, {
        leadId: lead.id,
        expectedUpdatedAt: lead.updated_at,
        patch,
      });
      setActionMessage(successMessage);
      await load({ quiet: true });
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
                      disabled={!canEditLead}
                      onChange={(event) => setStatusDraft(event.target.value as EditableLeadStatus)}
                      className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={option.value === "converted" || option.value === "lost"}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Converted and lost require their completed move-in or disposition workflows.
                    </p>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canEditLead || actionLoading === "status" || statusDraft === lead.status}
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
                    {lead.can_read_clinical
                      ? formatReferralDetailDateOfBirth(lead.date_of_birth)
                      : "Restricted"}
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

          <RecordDetailSection
            title="Contacts"
            description="People to reach about this inquiry, with how they are related to the prospective resident."
          >
            {contactsState.status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading contacts…</p>
            ) : contactsState.status === "failed" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Contacts could not be read: {contactsState.message}
              </p>
            ) : contactsState.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No separate contact is recorded. The phone and email above are the prospective resident&apos;s own.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {contactsState.contacts.map((contact) => (
                  <li key={contact.person_contact_id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-foreground">
                      {contact.first_name} {contact.last_name}
                      <span className="ml-2 font-normal text-muted-foreground">{contact.relationship}</span>
                      {contact.is_primary ? (
                        <span className="ml-2 rounded-[6px] border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Primary contact
                        </span>
                      ) : null}
                    </p>
                    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</dt>
                        <dd className="mt-0.5 text-foreground">{formatReferralDetailPhone(contact.phone)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                        <dd className="mt-0.5 break-all text-foreground">{formatReferralDetailEmail(contact.email)}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground">{permissionSummary(contact)}</p>
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>

          <ReferralContactLog
            leadId={lead.id}
            prospectName={`${lead.first_name} ${lead.last_name}`.trim()}
            canWrite={canEditLead}
            episode={contactsState.status === "loaded" ? contactsState.episode : null}
            contacts={contactsState.status === "loaded" ? contactsState.contacts : []}
            onEpisodeChanged={refreshEpisode}
            historyRefreshKey={historyRefreshKey}
          />

          <ReferralTours
            leadId={lead.id}
            leadStatus={lead.status}
            episodeRevision={contactsState.status === "loaded" ? contactsState.episode?.episode_revision ?? null : null}
            onChanged={handleToursChanged}
          />

          <RecordDetailSection title="Notes">
            {lead.can_read_clinical ? (
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {lead.notes?.trim() || "No clinical notes recorded."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Clinical referral notes are restricted for your current role.
              </p>
            )}
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
