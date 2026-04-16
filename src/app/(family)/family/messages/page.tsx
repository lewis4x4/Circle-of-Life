"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Send, ShieldCheck, Loader2 } from "lucide-react";

import {
  fetchFamilyMessageResidents,
  fetchFamilyMessagesForResident,
  postFamilyMessage,
  type FamilyLinkedResidentOption,
  type FamilyMessageRow,
} from "@/lib/family/family-messages-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { cn } from "@/lib/utils";

export default function FamilyMessagesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [residents, setResidents] = useState<FamilyLinkedResidentOption[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FamilyMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setLoadingResidents(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoadingResidents(false);
      return;
    }
    try {
      const u = await supabase.auth.getUser();
      setCurrentUserId(u.data.user?.id ?? null);
      const result = await fetchFamilyMessageResidents(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setResidents([]);
        setSelectedResidentId(null);
      } else {
        setResidents(result.residents);
        setSelectedResidentId((prev) => {
          if (prev != null && result.residents.some((r) => r.id === prev)) return prev;
          return result.residents[0]?.id ?? null;
        });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load messaging.");
      setResidents([]);
      setSelectedResidentId(null);
    } finally {
      setLoadingResidents(false);
    }
  }, [supabase]);

  const loadMessages = useCallback(
    async (residentId: string) => {
      setLoadingMessages(true);
      setLoadError(null);
      try {
        const result = await fetchFamilyMessagesForResident(supabase, residentId);
        if (!result.ok) {
          setLoadError(result.error);
          setMessages([]);
        } else {
          setMessages(result.messages);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load messages.");
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    if (selectedResidentId) void loadMessages(selectedResidentId);
    else setMessages([]);
  }, [selectedResidentId, loadMessages]);

  const send = useCallback(async () => {
    if (!selectedResidentId || sending) return;
    setSending(true);
    setLoadError(null);
    try {
      const result = await postFamilyMessage(supabase, selectedResidentId, draft);
      if (!result.ok) {
        setLoadError(result.error);
      } else {
        setDraft("");
        await loadMessages(selectedResidentId);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }, [selectedResidentId, draft, sending, supabase, loadMessages]);

  if (configError) {
     return (
      <div className="rounded-xl border border-rose-200 bg-white/60 backdrop-blur-md px-6 py-4 text-sm text-rose-800 shadow-sm max-w-lg mx-auto mt-20">{configError}</div>
    );
  }

  if (loadingResidents) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-stone-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        <p className="text-sm font-medium tracking-wide">Securing connection…</p>
      </div>
    );
  }

  if (loadError && residents.length === 0) {
    return (
     <div className="space-y-4 pb-16 md:pb-0 max-w-md mx-auto text-center mt-20">
        <div className="rounded-2xl border border-rose-200 bg-white/70 backdrop-blur-xl px-4 py-6 text-sm text-rose-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <MessageSquare className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className="w-full h-12 rounded-full bg-white text-stone-700 font-medium border border-stone-200 shadow-sm hover:bg-stone-50 transition-colors cursor-pointer tap-responsive"
          onClick={() => void loadResidents()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="pb-8 flex flex-col items-center max-w-3xl mx-auto w-full px-4 pt-12 md:pt-20">
      <FamilySectionIntro
        active="messages"
        title="Messages"
        description="A calm place to ask questions, share updates, and keep the conversation anchored to your loved one."
        residentSummary={residents.length === 1 ? residents[0]?.displayName : residents.length > 1 ? `${residents[0]?.displayName ?? "Your loved one"} and others` : undefined}
      />

      <div className="w-full space-y-6">
         {/* VISIBILITY SCOPE */}
         <div className="glass-card-light rounded-[2rem] p-6 bg-white/60 text-center">
            <p className="inline-flex items-center justify-center gap-2 text-sm text-stone-600 font-medium w-full">
               <ShieldCheck className="h-5 w-5 text-emerald-500" />
               Messages are private, time-stamped, and visible to the care team.
            </p>
            <p className="mt-2 text-sm text-stone-500">
              Use messages for context and questions. Urgent medical concerns should still be directed to the facility right away.
            </p>
         </div>

         {residents.length === 0 ? (
           <div className="glass-card-light rounded-[2rem] p-10 text-center border-dashed border-2 border-stone-200/50">
             <p className="text-stone-600 font-serif text-xl italic mb-2">No linked residents.</p>
             <p className="text-sm text-stone-500 max-w-md mx-auto">
               Messaging is not available until your account is linked to a resident.
             </p>
           </div>
         ) : (
           <div className="glass-card-light rounded-[2.5rem] bg-white/80 overflow-hidden shadow-sm border-white">
             {/* Conversation Header & Target Selector */}
             <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex flex-wrap items-center justify-between gap-4">
               {residents.length > 1 ? (
                 <div className="flex items-center gap-3">
                   <span className="text-xs font-bold uppercase tracking-widest text-stone-400">Conversation for</span>
                   <select
                     className="bg-transparent font-serif text-lg text-stone-800 cursor-pointer focus:outline-none"
                     value={selectedResidentId ?? ""}
                     onChange={(e) => setSelectedResidentId(e.target.value || null)}
                   >
                     {residents.map((r) => (
                       <option key={r.id} value={r.id}>{r.displayName}</option>
                     ))}
                   </select>
                 </div>
               ) : (
                 <div className="flex items-center gap-3">
                   <span className="text-xs font-bold uppercase tracking-widest text-stone-400">Conversation for</span>
                   <span className="font-serif text-lg text-stone-800">{residents[0]?.displayName}</span>
                 </div>
               )}
               
               {loadError && (
                  <span className="text-xs text-rose-500 font-medium bg-rose-50 px-2 py-1 rounded-md">{loadError}</span>
               )}
               {loadError && residents.length > 0 ? (
                  <button
                    type="button"
                    className="text-stone-500 hover:text-stone-800 text-xs uppercase tracking-widest font-bold tap-responsive"
                    onClick={() => selectedResidentId && void loadMessages(selectedResidentId)}
                  >
                    Refresh
                  </button>
               ) : null}
             </div>

             {/* Message View Area (Scrollable conceptually, though we can let it grow inline for now) */}
             <div className="p-6 min-h-[300px] flex flex-col space-y-6">
                 {loadingMessages ? (
                    <div className="flex-1 flex justify-center items-center py-12 text-stone-400">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                 ) : messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center h-full">
                       <MessageSquare className="w-12 h-12 text-stone-200 mb-4" />
                       <p className="text-stone-500 font-medium">It&apos;s quiet here.</p>
                       <p className="text-stone-400 text-sm mt-1">Send a message to the care team to start a thread.</p>
                    </div>
                 ) : (
                    messages.map((item) => {
                       const isSelfFamily = item.authorKind === "family" && currentUserId != null && item.authorUserId === currentUserId;
                       const isRight = isSelfFamily;
                       
                       // Moonshot bubble styling
                       const bubbleStyle = isRight
                         ? "bg-stone-800 text-white rounded-2xl rounded-tr-sm ml-auto"
                         : "bg-stone-100 text-stone-900 rounded-2xl rounded-tl-sm mr-auto";
                         
                       const authorLabel = item.authorKind === "staff" ? "Care Team" : isSelfFamily ? "You" : "Family";

                       return (
                         <div key={item.id} className={`flex w-full flex-col`}>
                           <div className={`max-w-[85%] sm:max-w-[70%] px-5 py-4 ${bubbleStyle} shadow-sm`}>
                             <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{item.body}</p>
                           </div>
                           {/* Meta info underneath bubble */}
                           <div className={`text-[11px] font-medium text-stone-400 mt-1.5 px-2 flex gap-2 ${isRight ? "justify-end" : "justify-start"}`}>
                             <span>{authorLabel}</span>
                             <span>&middot;</span>
                             <span>{item.timeLabel}</span>
                           </div>
                         </div>
                       );
                    })
                 )}
             </div>

             {/* Input Area */}
             <div className="p-4 sm:p-6 bg-white border-t border-stone-100">
               <div className="flex gap-3 items-end">
                   <div className="flex-1 relative">
                       <textarea
                         id="family-message-input"
                         rows={2}
                         value={draft}
                         onChange={(e) => setDraft(e.target.value)}
                         placeholder="Type a secure message…"
                         className="w-full resize-none rounded-[1.5rem] border border-stone-200 bg-stone-50/50 px-5 pt-3.5 pb-3 text-[15px] text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:bg-white transition-all shadow-inner"
                         disabled={!selectedResidentId || sending}
                       />
                   </div>
                   <button
                     type="button"
                     className={cn(
                        "w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-all tap-responsive mb-0.5 shadow-sm",
                        draft.trim().length > 0 && !sending ? "bg-stone-800 text-white hover:bg-stone-900" : "bg-stone-100 text-stone-300"
                     )}
                     disabled={!selectedResidentId || sending || !draft.trim()}
                     onClick={() => void send()}
                   >
                     {sending ? <Loader2 className="h-5 w-5 animate-spin text-stone-500" /> : <Send className="h-5 w-5 ml-0.5" />}
                   </button>
               </div>
               <p className="mt-3 text-[10px] uppercase font-bold tracking-widest text-stone-400 text-center">
                 Max 8,000 characters
               </p>
             </div>
           </div>
         )}
      </div>
    </div>
  );
}
