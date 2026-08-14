"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, MessageCircle, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import type {
  FamilyDeliveryMethod,
  StaffMessageRow,
  StaffMessageThread,
} from "@/lib/admin/family-messages-data";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  fetchStaffMessageThreads,
  fetchStaffMessagesForResident,
  postStaffMessage,
  familyDeliveryMethodOptions,
} from "@/lib/admin/family-messages-data";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

export default function StaffFamilyMessagesPage() {
  const { user } = useHavenAuth();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<StaffMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StaffMessageRow[]>([]);
  const [residentName, setResidentName] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<FamilyDeliveryMethod>("portal_only");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [threadFilter, setThreadFilter] = useState<"all" | "triage">("all");
  const [threadActionLoading, setThreadActionLoading] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);
  const [threadActionMessage, setThreadActionMessage] = useState<string | null>(null);
  const requestedFilter = searchParams.get("filter");

  useEffect(() => {
    if (requestedFilter === "triage") {
      setThreadFilter("triage");
      return;
    }
    setThreadFilter("all");
  }, [requestedFilter]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await fetchStaffMessageThreads(supabase);
      if (!result.ok) setError(result.error);
      else setThreads(result.threads);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load threads");
    } finally {
      setLoading(false);
    }
  }, []);

  const openThread = useCallback(async (residentId: string) => {
    setSelectedResidentId(residentId);
    setMsgLoading(true);
    setMsgError(null);
    try {
      const supabase = createClient();
      const result = await fetchStaffMessagesForResident(supabase, residentId);
      if (!result.ok) {
        setMsgError(result.error);
      } else {
        setMessages(result.messages);
        setResidentName(result.residentName);
      }
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setMsgLoading(false);
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!selectedResidentId || !draft.trim() || sending) return;
    setSending(true);
    try {
      const supabase = createClient();
      const result = await postStaffMessage(supabase, selectedResidentId, draft, deliveryMethod);
      if (!result.ok) {
        setMsgError(result.error);
      } else {
        setDraft("");
        await openThread(selectedResidentId);
      }
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [selectedResidentId, draft, deliveryMethod, sending, openThread]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const visibleThreads = threads.filter((thread) => {
    if (threadFilter === "triage") {
      return thread.triageStatus === "pending_review" || thread.triageStatus === "in_review";
    }
    return true;
  });
  const selectedThread = selectedResidentId
    ? threads.find((thread) => thread.residentId === selectedResidentId) ?? null
    : null;

  const updateThreadTriageStatus = useCallback(async (
    triageItemId: string,
    triageStatus: "in_review" | "resolved" | "false_positive",
    successMessage: string,
  ) => {
    setThreadActionLoading(triageItemId);
    setThreadActionError(null);
    setThreadActionMessage(null);
    try {
      const supabase = createClient();
      if (!user?.id) {
        setThreadActionError("You must be signed in to update triage.");
        return;
      }
      const { error } = await supabase
        .from("family_message_triage_items")
        .update({
          triage_status: triageStatus,
          reviewed_at: triageStatus === "resolved" || triageStatus === "false_positive" ? new Date().toISOString() : null,
          reviewed_by: triageStatus === "resolved" || triageStatus === "false_positive" ? user.id : null,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq("id", triageItemId);
      if (error) throw error;
      setThreadActionMessage(successMessage);
      await loadThreads();
      if (selectedResidentId) {
        await openThread(selectedResidentId);
      }
    } catch (err) {
      setThreadActionError(err instanceof Error ? err.message : "Could not update triage.");
    } finally {
      setThreadActionLoading(null);
    }
  }, [loadThreads, openThread, selectedResidentId, user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex flex-col items-center gap-4 mt-20">
         <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
            <span className="font-bold">!</span>
         </div>
         {error}
         <Button variant="outline" size="sm" onClick={() => { void loadThreads(); }}>Try Again</Button>
      </div>
    );
  }

  if (selectedResidentId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        {/* Thread Header */}
        <div className="flex flex-col gap-6 md:flex-row md:items-center justify-between bg-card p-6 md:p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
           <div className="flex items-center gap-6">
             <button
               onClick={() => {
                 setSelectedResidentId(null);
                 setMessages([]);
                 void loadThreads();
               }}
               className="w-12 h-12 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/5 transition-colors shrink-0 text-slate-500 hover:text-slate-900 dark:hover:text-white group tap-responsive"
               aria-label="Back to threads"
             >
               <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
             </button>
             <div>
               <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-2">
                   One-way note
               </div>
               <h2 className="text-2xl md:text-3xl font-medium tracking-tight text-slate-900 dark:text-white">
                 {residentName}
               </h2>
               {selectedThread?.triageStatus ? (
                 <div className="mt-3 flex flex-wrap gap-2">
                   <span className={cn(
                     "inline-flex items-center px-3 py-1 rounded-full border shadow-inner text-[10px] font-bold uppercase tracking-wider",
                     selectedThread.triageStatus === "pending_review"
                       ? "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400"
                       : selectedThread.triageStatus === "in_review"
                         ? "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400"
                         : selectedThread.triageStatus === "resolved"
                           ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-300"
                           : "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-300",
                   )}>
                     {selectedThread.triageStatus.replace(/_/g, " ")}
                   </span>
                   {selectedThread.triageKeywords.map((keyword) => (
                     <span
                       key={keyword}
                       className="inline-flex items-center px-3 py-1 rounded-full border shadow-inner bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400 text-[10px] font-bold uppercase tracking-wider"
                     >
                       {keyword}
                     </span>
                   ))}
                 </div>
               ) : null}
             </div>
           </div>
        </div>

        {threadActionError ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4 ">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
              <span className="font-bold">!</span>
            </div>
            {threadActionError}
          </div>
        ) : null}
        {threadActionMessage ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-6 text-sm text-emerald-700 dark:text-emerald-300 font-medium tracking-wide flex items-center gap-4 ">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <span className="font-bold">✓</span>
            </div>
            {threadActionMessage}
          </div>
        ) : null}

        {selectedThread?.triageItemId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={threadActionLoading === selectedThread.triageItemId || selectedThread.triageStatus === "in_review"}
              onClick={() => void updateThreadTriageStatus(selectedThread.triageItemId as string, "in_review", "Thread triage moved to in review.")}
            >
              In review
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={threadActionLoading === selectedThread.triageItemId || selectedThread.triageStatus === "resolved"}
              onClick={() => void updateThreadTriageStatus(selectedThread.triageItemId as string, "resolved", "Thread triage resolved.")}
            >
              Resolve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={threadActionLoading === selectedThread.triageItemId || selectedThread.triageStatus === "false_positive"}
              onClick={() => void updateThreadTriageStatus(selectedThread.triageItemId as string, "false_positive", "Thread triage marked false positive.")}
            >
              False positive
            </Button>
          </div>
        ) : null}

        {/* Messages Body */}
        {msgLoading ? (
          <div className="flex items-center justify-center py-40">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : msgError ? (
          <div className="mx-auto rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400 font-medium tracking-wide flex flex-col items-center gap-4">
             <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
                <span className="font-bold">!</span>
             </div>
             {msgError}
             <Button variant="outline" size="sm" onClick={() => { void openThread(selectedResidentId); }}>Retry</Button>
          </div>
        ) : (
          <>
          <div className="border-slate-200/60 dark:border-white/5 rounded-lg bg-card dark:bg-white/[0.015] shadow-sm overflow-hidden flex flex-col h-[65vh]">
             
             {/* Feed */}
             <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <MessageCircle className="h-12 w-12 text-slate-300 dark:text-white/10 mb-4" />
                    <p className="text-sm font-medium text-slate-500 dark:text-zinc-500">No notes yet. Post the first update to the family portal.</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isStaff = m.authorKind === "staff";
                    return (
                      <div key={m.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
                        <div
                          className={cn(
                             "max-w-[85%] md:max-w-[70%] rounded-lg px-6 py-4 text-sm shadow-sm",
                             isStaff 
                               ? "bg-primary-600 text-white rounded-br-sm" 
                               : "bg-white text-slate-900 border border-slate-200/60 dark:bg-white/5 dark:border-white/10 dark:text-white rounded-bl-sm"
                          )}
                        >
                          <div className="flex items-center gap-2 mb-2">
                             <p className={cn("text-[10px] font-bold uppercase tracking-wider", isStaff ? "text-primary-200" : "text-slate-500 dark:text-zinc-400")}>
                               {m.authorName} <span className="opacity-50 mx-1">•</span> {m.createdAt}
                             </p>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{m.body}</p>
                          {m.authorKind === "staff" ? (
                            <p className={cn("mt-2 text-[10px] font-bold uppercase tracking-wider", isStaff ? "text-primary-200" : "text-slate-500") }>
                              {m.deliveryMethod.replace(/_/g, " ")}
                            </p>
                          ) : null}
                          {m.familyAcknowledgedAt ? (
                            <p className={cn("mt-1 text-[10px] font-bold uppercase tracking-wider", isStaff ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-300") }>
                              Family acknowledged {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(m.familyAcknowledgedAt))}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
             </div>

             {/* Composer */}
             <div className="p-4 md:p-6 bg-slate-50/50 border-t border-slate-200/50 dark:border-white/5 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Delivery</label>
                  <select
                    value={deliveryMethod}
                    onChange={(event) => setDeliveryMethod(event.target.value as FamilyDeliveryMethod)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-white/10"
                  >
                    {familyDeliveryMethodOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 items-end">
                <textarea
                  placeholder="Post a one-way note to the family portal…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={8000}
                  rows={1}
                  style={{ minHeight: "56px" }}
                  className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-6 py-4 text-[15px] shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-ring dark:text-zinc-100 placeholder:text-slate-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.shiftKey)) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <button
                  onClick={() => { void handleSend(); }}
                  disabled={!draft.trim() || sending}
                  className="h-14 w-14 rounded-full bg-primary-600 hover:bg-primary-700 text-white flex items-center justify-center shrink-0 shadow-md transition-all tap-responsive disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-0.5" />}
                </button>
             </div>
             </div>
          </div>
          <div className="flex justify-end px-4">
             <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{draft.length}/8000 · Cmd+Enter to send</p>
          </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12 w-full">
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
         <div className="space-y-2">
           
           <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Family Portal Notes
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             One-way updates from staff to families. Families cannot reply from the portal.
           </p>
         </div>
      </div>

      {threads.length === 0 ? (
         <div className="border-slate-200/60 dark:border-white/5 rounded-lg bg-card dark:bg-white/[0.015] shadow-sm overflow-hidden p-20 flex flex-col items-center text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500 mb-6 opacity-80" />
            <h3 className="text-xl font-medium text-slate-900 dark:text-white mb-2">Inbox Zero</h3>
            <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 max-w-sm">No family conversations currently require attention.</p>
         </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4 px-2">
            <MessageCircle className="h-5 w-5 text-primary-500" />
            <h3 className="text-xl font-medium text-slate-900 dark:text-white tracking-tight">
              Resident threads
            </h3>
            {threadFilter !== "all" ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full border shadow-inner bg-primary-500/10 text-primary-600 border-primary-500/20 dark:text-primary-400 text-[10px] font-bold uppercase tracking-wider">
                {visibleThreads.length} visible
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 px-2">
            {[
              { key: "all", label: `All (${threads.length})` },
              { key: "triage", label: `Triage (${threads.filter((t) => t.triageStatus === "pending_review" || t.triageStatus === "in_review").length})` },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setThreadFilter(option.key as "all" | "triage")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  threadFilter === option.key
                    ? "bg-primary-600 text-white"
                    : "bg-white/80 text-slate-600 hover:bg-white dark:bg-black/20 dark:text-zinc-300 dark:hover:bg-black/30",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {threadFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2 px-2">
              <span className="inline-flex items-center px-3 py-1 rounded-full border shadow-inner bg-primary-500/10 text-primary-600 border-primary-500/20 dark:text-primary-400 text-[10px] font-bold uppercase tracking-wider">
                Thread filter: {threadFilter}
              </span>
              <Link href="/admin/family-messages" className={cn("rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors")}>
                Clear thread filter
              </Link>
            </div>
          ) : null}

          <MotionList className="grid gap-4 sm:grid-cols-2">
            {visibleThreads.length === 0 ? (
              <div className="col-span-full rounded-lg border border-slate-200/60 bg-card p-10 text-center text-sm text-slate-500 shadow-sm dark:border-white/5 dark:text-zinc-400">
                No threads match this filter.
              </div>
            ) : visibleThreads.map((t) => (
              <MotionItem key={t.residentId}>
                <div
                  className="group cursor-pointer tap-responsive rounded-lg bg-card border border-slate-200/50 dark:border-white/5 shadow-sm hover:shadow-xl dark:hover:bg-white/[0.03] transition-all duration-300 p-6 md:p-8"
                  onClick={() => { void openThread(t.residentId); }}
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="space-y-1">
                      <h3 className="text-xl md:text-2xl font-semibold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors tracking-tight">
                        {t.residentName}
                      </h3>
                      <p className="text-sm font-mono text-slate-500 dark:text-zinc-500">{t.roomLabel}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                        {t.lastMessageAt}
                      </span>
                      {t.triageStatus === "pending_review" ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full border shadow-inner bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400 text-[10px] font-bold uppercase tracking-wider">
                          Triage pending
                        </span>
                      ) : t.triageStatus === "in_review" ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full border shadow-inner bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                          Triage in review
                        </span>
                      ) : null}
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-100 dark:border-white/5">
                    <p className="text-[15px] text-slate-600 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                      <span className="font-bold text-slate-900 dark:text-white mr-2 opacity-80 uppercase tracking-wider text-[10px]">
                        {t.lastAuthorKind === "staff" ? "Staff" : "Legacy"}
                      </span>
                      {t.lastMessageBody}
                    </p>
                    <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Delivery: {t.latestDeliveryMethod.replace(/_/g, " ")}
                    </p>
                    {t.latestFamilyAcknowledgedAt ? (
                      <p className="mt-1 text-[11px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Ack: {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t.latestFamilyAcknowledgedAt))}
                      </p>
                    ) : null}
                    {t.triageKeywords.length > 0 ? (
                      <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        {t.triageKeywords.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  
                  <div className="mt-5 flex items-center gap-2">
                     <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                       {t.messageCount} Message{t.messageCount !== 1 ? "s" : ""}
                     </div>
                  </div>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        </div>
      )}
    </div>
  );
}
