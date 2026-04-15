"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Heart, MessageCircle, Info, Calendar, FileCheck2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Button } from "@/components/ui/button";
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

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminFamilyPortalPage() {
  const supabase = createClient();
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
          .order("updated_at", { ascending: false })
          .limit(25),
        supabase
          .from("family_care_conference_sessions")
          .select("id, status, scheduled_start, scheduled_end, recording_consent, external_room_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("scheduled_start", { ascending: false })
          .limit(25),
        supabase
          .from("family_consent_records")
          .select("id, consent_type, document_version, signed_at, family_user_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("signed_at", { ascending: false })
          .limit(25),
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

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Pipeline
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Family Connections
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Triage, conferences, and consent records for the selected facility.
           </p>
         </div>
         <div>
           <Link
             href="/admin/family-messages"
             className="px-6 py-3 rounded-full text-sm font-bold uppercase tracking-widest bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm border border-slate-200/50 dark:border-white/10 hover:shadow-md transition-all tap-responsive inline-flex items-center gap-3 outline-none"
           >
             <MessageCircle className="h-4 w-4" aria-hidden />
             Go to Direct Messages
           </Link>
         </div>
      </div>

      {!facilityReady && (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm mx-6">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load triage, conferences, and consents.
        </div>
      )}

      {loadError && (
        <div className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm mx-6">
           <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
              <span className="font-bold">!</span>
           </div>
           {loadError}
        </div>
      )}
      {actionError && (
        <div className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm mx-6">
           <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
              <span className="font-bold">!</span>
           </div>
           {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-[1.5rem] border border-emerald-500/20 bg-emerald-500/5 p-6 text-sm text-emerald-700 dark:text-emerald-300 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm mx-6">
           <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <span className="font-bold">✓</span>
           </div>
           {actionMessage}
        </div>
      )}

      {/* ─── MESSAGE TRIAGE ─── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4 px-2">
          <Heart className="h-5 w-5 text-rose-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white tracking-tight">
            Message Triage
          </h3>
        </div>

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="hidden lg:grid grid-cols-[2fr_1fr_2fr_3fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Keywords</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Message Snippet</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading queue...
               </div>
             ) : triage.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center gap-3">
                 <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                   <Info className="h-6 w-6 text-slate-400 dark:text-zinc-500"/>
                 </div>
                 No clinical triage anomalies detected in family messages.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {triage.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_2fr_3fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-rose-200 dark:hover:border-rose-500/30 transition-all duration-300 w-full cursor-pointer outline-none hover:shadow-lg dark:hover:bg-white/[0.05]">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                            <PulseDot colorClass="bg-rose-500" />
                          </div>
                          <span className="font-semibold text-xl text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-300 transition-colors tracking-tight font-display">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                          <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400">
                            {formatStatus(row.triage_status)}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Keywords</span>
                          <span className="text-sm font-mono text-rose-600 dark:text-rose-400 truncate max-w-[200px]">
                            {(row.matched_keywords?.length ?? 0) > 0 ? row.matched_keywords.join(", ") : "—"}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Snippet</span>
                          <span className="text-sm font-medium text-slate-700 dark:text-zinc-300 truncate max-w-[300px]">
                            {row.family_portal_messages?.body ?? "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-[11px] font-mono tracking-wide text-slate-500 dark:text-zinc-500 whitespace-nowrap">
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
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4 px-2 tracking-tight">
          <Calendar className="h-5 w-5 text-indigo-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white">
            Care Conferences
          </h3>
        </div>

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Start Time</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Recording OK</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Room</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading queue...
               </div>
             ) : conferences.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No scheduled conferences for this facility.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {conferences.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                          </div>
                          <span className="font-semibold text-xl text-slate-900 dark:text-white truncate tracking-tight font-display group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Start</span>
                          <span className="text-sm font-medium text-slate-700 dark:text-zinc-300">
                            {format(new Date(row.scheduled_start), "MMM d, yyyy p")}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                          <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400">
                            {formatStatus(row.status)}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Recording</span>
                          <span className={cn("text-xs font-bold uppercase tracking-widest", row.recording_consent ? "text-emerald-500" : "text-rose-500")}>
                            {row.recording_consent ? "Yes" : "No"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Room</span>
                          <div className="flex flex-col items-start lg:items-end gap-2">
                            <span className="text-sm font-mono text-slate-500 dark:text-zinc-500 truncate">
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
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4 px-2 tracking-tight">
          <FileCheck2 className="h-5 w-5 text-emerald-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white">
            Consent Records
          </h3>
        </div>

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
           <div className="hidden lg:grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Type</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Version</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Signed</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             {!facilityReady ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Awaiting facility selection...
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading queue...
               </div>
             ) : consents.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No consent records for this facility.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {consents.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          </div>
                          <span className="font-semibold text-xl text-slate-900 dark:text-white truncate tracking-tight font-display group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "—"}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Type</span>
                          <span className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
                            {row.consent_type}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Version</span>
                          <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                            {row.document_version}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-start items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Signed</span>
                          <span className="text-[11px] font-mono tracking-wide text-slate-500 dark:text-zinc-500">
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
