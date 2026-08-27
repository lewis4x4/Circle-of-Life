"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { addDays, format } from "date-fns";
import { AlertCircle, Calendar, ClipboardList, FileText } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard, type KpiCardTone } from "@/components/ui/kpi-card";
import { MotionItem, MotionList } from "@/components/ui/motion-list";
import { StatusPill } from "@/components/ui/status-pill";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { logSupabasePostgrestError } from "@/lib/supabase/client-query-log";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database, Json } from "@/types/database";
import {
  familyPortalAdminKpiValue,
  formatFamilyPortalAdminConferenceRoom,
  formatFamilyPortalAdminMatchedKeywords,
  formatFamilyPortalAdminNoteBody,
  formatFamilyPortalAdminPageSubtitle,
  formatFamilyPortalAdminResidentName,
  resolveFamilyPortalAdminFacilityScope,
} from "@/lib/family/family-portal-admin-display-copy";
import { cn } from "@/lib/utils";

type TriageRow = Database["public"]["Tables"]["family_message_triage_items"]["Row"] & {
  family_portal_messages: { body: string } | null;
  residents: { first_name: string; last_name: string } | null;
};

type ConferenceRow = Database["public"]["Tables"]["family_care_conference_sessions"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

type ConsentRow = Database["public"]["Tables"]["family_consent_records"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

type TriageFilter = "all" | Database["public"]["Enums"]["family_message_triage_status"];
type ConferenceFilter = "upcoming" | "completed" | "cancelled";

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function consentExpiresWithinDays(metadata: Json | null, days: number): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const o = metadata as Record<string, unknown>;
  const raw = o.expires_at ?? o.expiration_date;
  if (typeof raw !== "string") return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t <= now + days * 86400000;
}

function FilterTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className={cn(
        "h-auto min-h-9 px-3 py-2 text-left text-[13px] font-medium leading-snug tracking-normal",
        active && "shadow-sm",
      )}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function QuietEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border py-6 text-left text-[13px] leading-relaxed text-muted-foreground">
      {children}
    </div>
  );
}

export default function AdminFamilyPortalPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const { user } = useHavenAuth();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [conferences, setConferences] = useState<ConferenceRow[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("all");
  const [conferenceFilter, setConferenceFilter] = useState<ConferenceFilter>("upcoming");
  const requestedTriageFilter = searchParams.get("triage");
  const requestedConferenceFilter = searchParams.get("conference");

  useEffect(() => {
    if (
      requestedTriageFilter === "pending_review" ||
      requestedTriageFilter === "in_review" ||
      requestedTriageFilter === "resolved" ||
      requestedTriageFilter === "false_positive"
    ) {
      setTriageFilter(requestedTriageFilter);
      return;
    }
    setTriageFilter("all");
  }, [requestedTriageFilter]);

  useEffect(() => {
    if (requestedConferenceFilter === "completed") {
      setConferenceFilter("completed");
      return;
    }
    if (requestedConferenceFilter === "cancelled") {
      setConferenceFilter("cancelled");
      return;
    }
    if (
      requestedConferenceFilter === "scheduled" ||
      requestedConferenceFilter === "upcoming" ||
      requestedConferenceFilter === "all" ||
      requestedConferenceFilter === null
    ) {
      setConferenceFilter("upcoming");
      return;
    }
    setConferenceFilter("upcoming");
  }, [requestedConferenceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setTriage([]);
      setConferences([]);
      setConsents([]);
      setLoading(false);
      return;
    }

    try {
      const [tRes, cRes, nRes] = await Promise.all([
        supabase
          .from("family_message_triage_items")
          .select(
            "id, triage_status, matched_keywords, reviewed_at, updated_at, family_portal_messages(body), residents(first_name, last_name)",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false }),
        supabase
          .from("family_care_conference_sessions")
          .select(
            "id, status, scheduled_start, scheduled_end, recording_consent, external_room_id, residents(first_name, last_name)",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("scheduled_start", { ascending: false }),
        supabase
          .from("family_consent_records")
          .select(
            "id, consent_type, document_version, signed_at, family_user_id, metadata, residents(first_name, last_name)",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("signed_at", { ascending: false }),
      ]);

      if (tRes.error) throw tRes.error;
      if (cRes.error) throw cRes.error;
      if (nRes.error) throw nRes.error;

      setTriage((tRes.data ?? []) as TriageRow[]);
      setConferences((cRes.data ?? []) as ConferenceRow[]);
      setConsents((nRes.data ?? []) as ConsentRow[]);
    } catch (e) {
      logSupabasePostgrestError("family-portal.load", e, { facilityId: selectedFacilityId });
      setLoadFailed(true);
      setTriage([]);
      setConferences([]);
      setConsents([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateTriageStatus(
    itemId: string,
    triageStatus: Database["public"]["Enums"]["family_message_triage_status"],
    successMessage: string,
  ) {
    setActionLoading(itemId);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error } = await supabase
        .from("family_message_triage_items")
        .update({
          triage_status: triageStatus,
          reviewed_at:
            triageStatus === "resolved" || triageStatus === "false_positive" ? new Date().toISOString() : null,
          reviewed_by:
            triageStatus === "resolved" || triageStatus === "false_positive" ? user?.id ?? null : null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", itemId);
      if (error) throw error;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      logSupabasePostgrestError("family-portal.triage-patch", err, { itemId });
      setActionError("Couldn't update triage. Retry or refresh.");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateConference(
    sessionId: string,
    patch: Partial<Database["public"]["Tables"]["family_care_conference_sessions"]["Update"]>,
    successMessage: string,
  ) {
    setActionLoading(sessionId);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error } = await supabase
        .from("family_care_conference_sessions")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", sessionId);
      if (error) throw error;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      logSupabasePostgrestError("family-portal.conference-patch", err, { sessionId });
      setActionError("Couldn't update conference. Retry or refresh.");
    } finally {
      setActionLoading(null);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const facilityName = useMemo(() => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null;
  }, [availableFacilities, selectedFacilityId]);

  const triageCounts = useMemo(() => {
    return {
      all: triage.length,
      pending_review: triage.filter((row) => row.triage_status === "pending_review").length,
      in_review: triage.filter((row) => row.triage_status === "in_review").length,
      resolved: triage.filter((row) => row.triage_status === "resolved").length,
      false_positive: triage.filter((row) => row.triage_status === "false_positive").length,
    };
  }, [triage]);

  const pendingAttentionCount = triageCounts.pending_review + triageCounts.in_review;

  const upcomingConferenceCount = useMemo(() => {
    const t = Date.now();
    return conferences.filter(
      (row) => row.status === "scheduled" && new Date(row.scheduled_start).getTime() > t,
    ).length;
  }, [conferences]);

  const conferencesThisWeekCount = useMemo(() => {
    const start = Date.now();
    const end = addDays(new Date(start), 7).getTime();
    return conferences.filter((row) => {
      if (row.status !== "scheduled") return false;
      const ms = new Date(row.scheduled_start).getTime();
      return ms > start && ms <= end;
    }).length;
  }, [conferences]);

  const consentsExpiringCount = useMemo(
    () => consents.filter((c) => consentExpiresWithinDays(c.metadata, 30)).length,
    [consents],
  );

  const consentExpiryTone: KpiCardTone =
    !facilityReady || consentsExpiringCount === 0
      ? "neutral"
      : consentsExpiringCount > 5
        ? "danger"
        : "warning";

  const triageIconClass =
    !facilityReady || pendingAttentionCount === 0
      ? "text-muted-foreground"
      : "text-amber-600 dark:text-amber-400";

  const consentIconClass =
    facilityReady && consentsExpiringCount > 5 ? "text-destructive" : "text-muted-foreground";

  const featuredTriage = useMemo(() => {
    const triagePriority: Record<Database["public"]["Enums"]["family_message_triage_status"], number> = {
      pending_review: 0,
      in_review: 1,
      resolved: 2,
      false_positive: 3,
    };
    return [...triage]
      .filter((row) => triageFilter === "all" || row.triage_status === triageFilter)
      .sort((a, b) => {
        const priorityDelta = triagePriority[a.triage_status] - triagePriority[b.triage_status];
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 12);
  }, [triage, triageFilter]);

  const featuredConferences = useMemo(() => {
    const t = Date.now();
    return [...conferences]
      .filter((row) => {
        if (conferenceFilter === "completed") return row.status === "completed";
        if (conferenceFilter === "cancelled") return row.status === "cancelled";
        return row.status === "scheduled" && new Date(row.scheduled_start).getTime() > t;
      })
      .sort((a, b) => {
        if (conferenceFilter === "upcoming") {
          return new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime();
        }
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 12);
  }, [conferenceFilter, conferences]);

  const featuredConsents = useMemo(() => {
    return [...consents]
      .sort((a, b) => new Date(b.signed_at ?? 0).getTime() - new Date(a.signed_at ?? 0).getTime())
      .slice(0, 12);
  }, [consents]);

  const facilityScope = useMemo(
    () => resolveFamilyPortalAdminFacilityScope(facilityReady, facilityName),
    [facilityReady, facilityName],
  );

  const pageSubtitle = useMemo(
    () => formatFamilyPortalAdminPageSubtitle(facilityScope),
    [facilityScope],
  );

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-10 pb-12 pt-2">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Family Connections</h1>
        <p className="max-w-[52rem] text-[13px] leading-relaxed text-muted-foreground">
          {pageSubtitle}
        </p>
        <p className="max-w-[52rem] text-[12px] leading-relaxed text-muted-foreground">
          Haven → family only. Families cannot reply in the portal; staff post updates from the bulletin log.
        </p>
      </header>

      <section aria-label="Needs attention" className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">Needs attention</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard
            value={familyPortalAdminKpiValue("pending_triage", facilityReady, pendingAttentionCount)}
            label="Pending triage"
            tone={pendingAttentionCount > 0 ? "warning" : "neutral"}
            footnote={
              facilityReady ? undefined : <span>Select a facility to load operational counts.</span>
            }
          />
          <KpiCard
            value={familyPortalAdminKpiValue(
              "conferences_this_week",
              facilityReady,
              conferencesThisWeekCount,
            )}
            label="Conferences this week"
            tone="neutral"
            footnote={undefined}
          />
          <KpiCard
            value={familyPortalAdminKpiValue(
              "consents_expiring",
              facilityReady,
              consentsExpiringCount,
            )}
            label="Consents expiring in 30 days"
            tone={consentExpiryTone}
            footnote={
              facilityReady ? (
                <span>Counts consent rows whose metadata includes an expiration date within the next 30 days.</span>
              ) : undefined
            }
          />
        </div>
      </section>

      {!facilityReady && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">
          Select a facility in the header to load triage, conferences, and consents.
        </div>
      )}

      {loadFailed && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          Couldn&apos;t load Family Connections.{" "}
          <button
            type="button"
            className="font-medium underline-offset-4 hover:underline"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-900 dark:text-emerald-200">
          {actionMessage}
        </div>
      )}

      {/* Message Triage */}
      <div id="message-triage" className="space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className={cn("h-5 w-5 shrink-0", triageIconClass)} aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Posted-note triage</h2>
            {triageFilter !== "all" ? (
              <Badge variant="outline" className="font-normal">
                {featuredTriage.length} visible
              </Badge>
            ) : null}
          </div>
          <Link
            href="/admin/family-messages"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "inline-flex items-center gap-2 self-start text-[13px] font-medium sm:self-auto",
            )}
          >
            <ClipboardList className="h-4 w-4" aria-hidden />
            Post family bulletin
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card px-4 py-5 shadow-[var(--shadow-card)] ring-1 ring-border/60 md:px-5 md:py-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                { value: "all", label: `All (${triageCounts.all})` },
                { value: "pending_review", label: `Pending (${triageCounts.pending_review})` },
                { value: "in_review", label: `In review (${triageCounts.in_review})` },
                { value: "resolved", label: `Resolved (${triageCounts.resolved})` },
                { value: "false_positive", label: `False positive (${triageCounts.false_positive})` },
              ] as Array<{ value: TriageFilter; label: string }>
            ).map((option) => (
              <FilterTab
                key={option.value}
                active={triageFilter === option.value}
                label={option.label}
                onClick={() => setTriageFilter(option.value)}
              />
            ))}
          </div>
          {triageFilter !== "all" ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-normal">
                Filter: {formatStatus(triageFilter)}
              </Badge>
              <button
                type="button"
                className="text-[12px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setTriageFilter("all")}
              >
                Clear filter
              </button>
            </div>
          ) : null}

          <div className="hidden items-center gap-3 border-b border-border bg-muted/20 px-[13px] py-2 text-[12px] text-muted-foreground lg:flex">
            <div className="flex-[2]">Resident</div>
            <div className="flex-1">Status</div>
            <div className="flex-[2]">Keywords</div>
            <div className="flex-[3]">Message snippet</div>
            <div className="flex-1 text-right">Updated</div>
          </div>

          <div className="mt-4 space-y-3">
            {!facilityReady ? (
              <QuietEmptyState>Awaiting facility selection.</QuietEmptyState>
            ) : loading ? (
              <QuietEmptyState>Loading…</QuietEmptyState>
            ) : triage.length === 0 ? (
              <QuietEmptyState>
                No clinical triage flags on posted family notes. Staff bulletin posts families can read will appear
                here when keywords need review.
              </QuietEmptyState>
            ) : featuredTriage.length === 0 ? (
              <QuietEmptyState>No triage items match this filter.</QuietEmptyState>
            ) : (
              <MotionList className="space-y-3">
                {featuredTriage.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="grid min-h-[36px] grid-cols-1 items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-colors hover:bg-muted/30 lg:grid-cols-[2fr_1fr_2fr_3fr_1fr]">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {formatFamilyPortalAdminResidentName(row.residents)}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Status</span>
                        <StatusPill
                          tone={
                            row.triage_status === "pending_review" || row.triage_status === "in_review"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {formatStatus(row.triage_status)}
                        </StatusPill>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Keywords</span>
                        <span className="max-w-[200px] truncate text-[12px] text-muted-foreground">
                          {formatFamilyPortalAdminMatchedKeywords(row.matched_keywords)}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Message snippet</span>
                        <span className="max-w-[300px] truncate text-[13px] text-foreground">
                          {formatFamilyPortalAdminNoteBody(row.family_portal_messages?.body)}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-end">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Updated</span>
                        <div className="flex flex-col items-end gap-2">
                          <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                            {format(new Date(row.updated_at), "MMM d, yyyy")}
                          </span>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.triage_status === "in_review"}
                              onClick={() => void updateTriageStatus(row.id, "in_review", "Message triage moved to in review.")}
                            >
                              In review
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.triage_status === "resolved"}
                              onClick={() => void updateTriageStatus(row.id, "resolved", "Message triage resolved.")}
                            >
                              Resolve
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.triage_status === "false_positive"}
                              onClick={() =>
                                void updateTriageStatus(row.id, "false_positive", "Message triage marked false positive.")
                              }
                            >
                              False positive
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </div>
        </div>
      </div>

      {/* Care conferences */}
      <div id="care-conferences" className="space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Care conferences</h2>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card px-4 py-5 shadow-[var(--shadow-card)] ring-1 ring-border/60 md:px-5 md:py-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                {
                  value: "upcoming" as const,
                  label: `Upcoming (${upcomingConferenceCount})`,
                },
                {
                  value: "completed" as const,
                  label: `Completed (${conferences.filter((r) => r.status === "completed").length})`,
                },
                {
                  value: "cancelled" as const,
                  label: `Cancelled (${conferences.filter((r) => r.status === "cancelled").length})`,
                },
              ] as const
            ).map((option) => (
              <FilterTab
                key={option.value}
                active={conferenceFilter === option.value}
                label={option.label}
                onClick={() => setConferenceFilter(option.value)}
              />
            ))}
          </div>

          <div className="hidden items-center gap-3 border-b border-border bg-muted/20 px-[13px] py-2 text-[12px] text-muted-foreground lg:flex">
            <div className="flex-[2]">Resident</div>
            <div className="flex-[1.5]">Start time</div>
            <div className="flex-1">Status</div>
            <div className="flex-1">Recording consent</div>
            <div className="flex-1">Room</div>
          </div>

          <div className="mt-4 space-y-3">
            {!facilityReady ? (
              <QuietEmptyState>Awaiting facility selection.</QuietEmptyState>
            ) : loading ? (
              <QuietEmptyState>Loading…</QuietEmptyState>
            ) : conferences.length === 0 ? (
              <QuietEmptyState>
                No upcoming conferences. Schedule one when a resident is admitted, annually, or after a significant
                change in condition.
              </QuietEmptyState>
            ) : featuredConferences.length === 0 ? (
              <QuietEmptyState>No conferences match this filter.</QuietEmptyState>
            ) : (
              <MotionList className="space-y-3">
                {featuredConferences.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="grid min-h-[36px] grid-cols-1 items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-colors hover:bg-muted/30 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr]">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {formatFamilyPortalAdminResidentName(row.residents)}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Start time</span>
                        <span className="text-[13px] text-foreground">
                          {format(new Date(row.scheduled_start), "MMM d, yyyy p")}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Status</span>
                        <StatusPill tone="muted">{formatStatus(row.status)}</StatusPill>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Recording consent</span>
                        <span
                          className={cn(
                            "text-[12px] font-medium",
                            row.recording_consent ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                          )}
                        >
                          {row.recording_consent ? "Granted" : "Not granted"}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Room</span>
                        <div className="flex flex-col items-start gap-2 lg:items-end">
                          <span className="max-w-full truncate font-mono text-[12px] tabular-nums text-muted-foreground">
                            {formatFamilyPortalAdminConferenceRoom(row.external_room_id)}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.status === "completed"}
                              onClick={() =>
                                void updateConference(row.id, { status: "completed" }, "Care conference marked completed.")
                              }
                            >
                              Complete
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.status === "cancelled"}
                              onClick={() =>
                                void updateConference(row.id, { status: "cancelled" }, "Care conference cancelled.")
                              }
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === row.id || row.recording_consent}
                              onClick={() =>
                                void updateConference(
                                  row.id,
                                  {
                                    recording_consent: true,
                                    recording_consent_at: row.recording_consent_at ?? new Date().toISOString(),
                                    recording_consent_by: row.recording_consent_by ?? user?.id ?? null,
                                  },
                                  "Recording consent documented.",
                                )
                              }
                            >
                              Record consent
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </div>
        </div>
      </div>

      {/* Consent records */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <FileText className={cn("h-5 w-5 shrink-0", consentIconClass)} aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Consent records</h2>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card px-4 py-5 shadow-[var(--shadow-card)] ring-1 ring-border/60 md:px-5 md:py-6">
          <div className="hidden items-center gap-3 border-b border-border bg-muted/20 px-[13px] py-2 text-[12px] text-muted-foreground lg:flex">
            <div className="flex-[2]">Resident</div>
            <div className="flex-[2]">Type</div>
            <div className="flex-1">Version</div>
            <div className="flex-1">Signed</div>
          </div>

          <div className="mt-4 space-y-3">
            {!facilityReady ? (
              <QuietEmptyState>Awaiting facility selection.</QuietEmptyState>
            ) : loading ? (
              <QuietEmptyState>Loading…</QuietEmptyState>
            ) : consents.length === 0 ? (
              <QuietEmptyState>
                No consent records on file. Add HIPAA, photo release, and care planning consents during admission.
              </QuietEmptyState>
            ) : (
              <MotionList className="space-y-3">
                {featuredConsents.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="grid min-h-[36px] grid-cols-1 items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-colors hover:bg-muted/30 lg:grid-cols-[2fr_2fr_1fr_1fr]">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {formatFamilyPortalAdminResidentName(row.residents)}
                        </span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Type</span>
                        <span className="text-[13px] font-medium text-foreground">{row.consent_type}</span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Version</span>
                        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.document_version}</span>
                      </div>

                      <div className="flex flex-row items-center justify-between lg:justify-start">
                        <span className="text-[12px] text-muted-foreground lg:hidden">Signed</span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">
                          {format(new Date(row.signed_at), "MMM d, yyyy")}
                        </span>
                      </div>
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
