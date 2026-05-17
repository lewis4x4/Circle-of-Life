"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Heart, MessageCircle, Info, Calendar, FileCheck2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHavenAuth } from "@/contexts/haven-auth-context";

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
type ConferenceFilter = "all" | Database["public"]["Enums"]["family_care_conference_status"] | "upcoming";

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminFamilyPortalPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [conferences, setConferences] = useState<ConferenceRow[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("all");
  const [conferenceFilter, setConferenceFilter] = useState<ConferenceFilter>("all");
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
    if (
      requestedConferenceFilter === "scheduled" ||
      requestedConferenceFilter === "upcoming" ||
      requestedConferenceFilter === "completed" ||
      requestedConferenceFilter === "cancelled"
    ) {
      setConferenceFilter(requestedConferenceFilter);
      return;
    }
    setConferenceFilter("all");
  }, [requestedConferenceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
          .select("id, status, scheduled_start, scheduled_end, recording_consent, external_room_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("scheduled_start", { ascending: false }),
        supabase
          .from("family_consent_records")
          .select("id, consent_type, document_version, signed_at, family_user_id, residents(first_name, last_name)")
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
      setLoadError(e instanceof Error ? e.message : "Failed to load family portal data.");
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
          reviewed_at: triageStatus === "resolved" || triageStatus === "false_positive" ? new Date().toISOString() : null,
          reviewed_by: triageStatus === "resolved" || triageStatus === "false_positive" ? user?.id ?? null : null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", itemId);
      if (error) throw error;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update triage item.");
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
      setActionError(err instanceof Error ? err.message : "Could not update care conference.");
    } finally {
      setActionLoading(null);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const triageCounts = useMemo(() => {
    return {
      all: triage.length,
      pending_review: triage.filter((row) => row.triage_status === "pending_review").length,
      in_review: triage.filter((row) => row.triage_status === "in_review").length,
      resolved: triage.filter((row) => row.triage_status === "resolved").length,
      false_positive: triage.filter((row) => row.triage_status === "false_positive").length,
    };
  }, [triage]);
  const conferenceCounts = useMemo(() => {
    return {
      all: conferences.length,
      scheduled: conferences.filter((row) => row.status === "scheduled").length,
      completed: conferences.filter((row) => row.status === "completed").length,
      cancelled: conferences.filter((row) => row.status === "cancelled").length,
    };
  }, [conferences]);
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
    return [...conferences]
      .filter((row) => {
        if (conferenceFilter === "all") return true;
        if (conferenceFilter === "upcoming") {
          return row.status === "scheduled" && new Date(row.scheduled_start).getTime() >= Date.now();
        }
        return row.status === conferenceFilter;
      })
      .sort((a, b) => {
        if (a.status === "scheduled" && b.status !== "scheduled") return -1;
        if (a.status !== "scheduled" && b.status === "scheduled") return 1;
        if (a.status === "scheduled" && b.status === "scheduled") {
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

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
         <div className="space-y-2">
           
           <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Family Connections
           </h1>
           <p className="mt-2 font-medium tracking-wide text-muted-foreground">
             Triage, conferences, and consent records for the selected facility.
           </p>
         </div>
         <div>
           <Link
             href="/admin/family-messages"
             className="px-6 py-3 rounded-full text-sm font-bold uppercase tracking-wider bg-card text-foreground shadow-sm border border-border hover:bg-muted/40 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] tap-responsive inline-flex items-center gap-3 outline-none"
           >
             <MessageCircle className="h-4 w-4" aria-hidden />
             Go to Direct Messages
           </Link>
         </div>
      </div>

      {!facilityReady && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 mx-6">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load triage, conferences, and consents.
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4 mx-6">
           <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
              <span className="font-bold">!</span>
           </div>
           {loadError}
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4 mx-6">
           <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
              <span className="font-bold">!</span>
           </div>
           {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-6 text-sm text-emerald-700 dark:text-emerald-300 font-medium tracking-wide flex items-center gap-4 mx-6">
           <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <span className="font-bold">✓</span>
           </div>
           {actionMessage}
        </div>
      )}

      {/* ─── MESSAGE TRIAGE ─── */}
      <div id="message-triage" className="space-y-6">
        <div className="flex items-center gap-3 border-b border-border pb-4 px-2">
          <Heart className="h-5 w-5 text-rose-500" />
          <h3 className="text-xl font-medium text-foreground tracking-tight">
            Message Triage
          </h3>
          {triageFilter !== "all" ? (
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              {featuredTriage.length} visible
            </Badge>
          ) : null}
        </div>

        <div className="border-border rounded-lg bg-card shadow-sm overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="relative z-10 mb-6 flex flex-wrap items-center gap-2">
             {([
               { value: "all", label: `All (${triageCounts.all})` },
               { value: "pending_review", label: `Pending (${triageCounts.pending_review})` },
               { value: "in_review", label: `In review (${triageCounts.in_review})` },
               { value: "resolved", label: `Resolved (${triageCounts.resolved})` },
               { value: "false_positive", label: `False positive (${triageCounts.false_positive})` },
             ] as Array<{ value: TriageFilter; label: string }>).map((option) => (
               <button
                 key={option.value}
                 type="button"
                 onClick={() => setTriageFilter(option.value)}
                 className={cn(
                   "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                   triageFilter === option.value
                     ? "bg-rose-600 text-white"
                     : "bg-muted/40 text-muted-foreground hover:bg-muted",
                 )}
               >
                {option.label}
              </button>
            ))}
          </div>
          {triageFilter !== "all" ? (
            <div className="relative z-10 mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                Triage filter: {formatStatus(triageFilter)}
              </Badge>
              <Link href="/admin/family-portal#message-triage" className={cn("rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors duration-[var(--motion-duration-micro)]")}>
                Clear triage filter
              </Link>
            </div>
          ) : null}
           <div className="hidden lg:flex items-center gap-3 px-[13px] py-2 border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
             <div className="flex-[2]">Resident</div>
             <div className="flex-1">Status</div>
             <div className="flex-[2]">Keywords</div>
             <div className="flex-[3]">Message Snippet</div>
             <div className="flex-1 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-4">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Loading queue...
               </div>
             ) : triage.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-3">
                 <div className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center">
                   <Info className="h-6 w-6 text-muted-foreground"/>
                 </div>
                 No clinical triage anomalies detected in family messages.
               </div>
             ) : featuredTriage.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No triage items match this filter.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {featuredTriage.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_2fr_3fr_1fr] gap-3 items-center min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card tap-responsive group hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                            <></>
                          </div>
                          <span className="text-[13px] font-semibold text-foreground truncate tracking-tight">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Status</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-full border shadow-inner bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400">
                            {formatStatus(row.triage_status)}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Keywords</span>
                          <span className="text-[12px] text-rose-600 dark:text-rose-400 truncate max-w-[200px]">
                            {(row.matched_keywords?.length ?? 0) > 0 ? row.matched_keywords.join(", ") : "—"}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Snippet</span>
                          <span className="text-[13px] text-foreground truncate max-w-[300px]">
                            {row.family_portal_messages?.body ?? "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Updated</span>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-[12px] font-mono tracking-wide tabular-nums text-muted-foreground whitespace-nowrap">
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
                                onClick={() => void updateTriageStatus(row.id, "false_positive", "Message triage marked false positive.")}
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

      {/* ─── CARE CONFERENCES ─── */}
      <div id="care-conferences" className="space-y-6">
        <div className="flex items-center gap-3 border-b border-border pb-4 px-2 tracking-tight">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-medium text-foreground">
            Care Conferences
          </h3>
          {conferenceFilter !== "all" ? (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {featuredConferences.length} visible
            </Badge>
          ) : null}
        </div>

        <div className="border-border rounded-lg bg-card shadow-sm overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="relative z-10 mb-6 flex flex-wrap items-center gap-2">
             {([
               { value: "all", label: `All (${conferenceCounts.all})` },
               { value: "upcoming", label: `Upcoming (${conferences.filter((row) => row.status === "scheduled" && new Date(row.scheduled_start).getTime() >= Date.now()).length})` },
               { value: "scheduled", label: `Scheduled (${conferenceCounts.scheduled})` },
               { value: "completed", label: `Completed (${conferenceCounts.completed})` },
               { value: "cancelled", label: `Cancelled (${conferenceCounts.cancelled})` },
             ] as Array<{ value: ConferenceFilter; label: string }>).map((option) => (
               <button
                 key={option.value}
                 type="button"
                 onClick={() => setConferenceFilter(option.value)}
                 className={cn(
                   "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                   conferenceFilter === option.value
                     ? "bg-indigo-600 text-white"
                     : "bg-muted/40 text-muted-foreground hover:bg-muted",
                 )}
               >
                {option.label}
              </button>
            ))}
          </div>
          {conferenceFilter !== "all" ? (
            <div className="relative z-10 mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                Conference filter: {conferenceFilter === "upcoming" ? "upcoming" : formatStatus(conferenceFilter)}
              </Badge>
              <Link href="/admin/family-portal#care-conferences" className={cn("rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors duration-[var(--motion-duration-micro)]")}>
                Clear conference filter
              </Link>
            </div>
          ) : null}
           <div className="hidden lg:flex items-center gap-3 px-[13px] py-2 border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
             <div className="flex-[2]">Resident</div>
             <div className="flex-[1.5]">Start Time</div>
             <div className="flex-1">Status</div>
             <div className="flex-1">Recording OK</div>
             <div className="flex-1">Room</div>
           </div>

           <div className="space-y-4 mt-4">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Loading queue...
               </div>
             ) : conferences.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No scheduled conferences for this facility.
               </div>
             ) : featuredConferences.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No conferences match this filter.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {featuredConferences.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-3 items-center min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] w-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          </div>
                          <span className="text-[13px] font-semibold text-foreground truncate tracking-tight">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Start</span>
                          <span className="text-[13px] text-foreground">
                            {format(new Date(row.scheduled_start), "MMM d, yyyy p")}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Status</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-full border shadow-inner bg-muted text-muted-foreground border-border">
                            {formatStatus(row.status)}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Recording</span>
                          <span className={cn("text-xs font-bold uppercase tracking-wider", row.recording_consent ? "text-emerald-500" : "text-rose-500")}>
                            {row.recording_consent ? "Yes" : "No"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Room</span>
                          <div className="flex flex-col items-start lg:items-end gap-2">
                            <span className="text-[12px] font-mono tabular-nums text-muted-foreground truncate">
                              {row.external_room_id ?? "—"}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={actionLoading === row.id || row.status === "completed"}
                                onClick={() =>
                                  void updateConference(
                                    row.id,
                                    { status: "completed" },
                                    "Care conference marked completed.",
                                  )
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
                                  void updateConference(
                                    row.id,
                                    { status: "cancelled" },
                                    "Care conference cancelled.",
                                  )
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

      {/* ─── CONSENT RECORDS ─── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-border pb-4 px-2 tracking-tight">
          <FileCheck2 className="h-5 w-5 text-emerald-500" />
          <h3 className="text-xl font-medium text-foreground">
            Consent Records
          </h3>
        </div>

        <div className="border-border rounded-lg bg-card shadow-sm overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="hidden lg:flex items-center gap-3 px-[13px] py-2 border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
             <div className="flex-[2]">Resident</div>
             <div className="flex-[2]">Type</div>
             <div className="flex-1">Version</div>
             <div className="flex-1">Signed</div>
           </div>

           <div className="space-y-4 mt-4">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Loading queue...
               </div>
             ) : consents.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No consent records for this facility.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {featuredConsents.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr_1fr] gap-3 items-center min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] w-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          </div>
                          <span className="text-[13px] font-semibold text-foreground truncate tracking-tight">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Type</span>
                          <span className="text-[13px] text-foreground font-medium">
                            {row.consent_type}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Version</span>
                          <span className="text-[12px] font-mono tabular-nums text-muted-foreground">
                            {row.document_version}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-[12px] text-muted-foreground uppercase tracking-wider font-bold">Signed</span>
                          <span className="text-[12px] font-mono tracking-wide tabular-nums text-muted-foreground">
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
