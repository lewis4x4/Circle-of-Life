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

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{configError}</div>
    );
  }

  if (loadingResidents) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading messages…
      </div>
    );
  }

  if (loadError && residents.length === 0) {
    return (
      <div className="space-y-3 pb-16 md:pb-0">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }), "border-stone-300")}
          onClick={() => void loadResidents()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Secure Messages</CardTitle>
          <CardDescription>
            Direct communication with your care team about a linked resident (Phase 1 — family can send; staff reply in
            admin workflows when enabled).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="inline-flex items-center gap-1 text-sm text-stone-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Messages are stored with audit logging for authorized roles.
          </p>
        </CardContent>
      </Card>

      {residents.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-600">
          No linked residents on your account, so messaging is not available yet.
        </p>
      ) : (
        <>
          {residents.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Conversation for</span>
              <select
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                value={selectedResidentId ?? ""}
                onChange={(e) => setSelectedResidentId(e.target.value || null)}
                aria-label="Select resident for messages"
              >
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {loadError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
          ) : null}

          <Card className="border-stone-200 bg-white text-stone-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingMessages ? (
                <div className="flex justify-center py-8 text-stone-500">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-600">No messages yet. Say hello to the care team below.</p>
              ) : (
                messages.map((item) => {
                  const isSelfFamily =
                    item.authorKind === "family" && currentUserId != null && item.authorUserId === currentUserId;
                  const isRight = isSelfFamily;
                  const authorLabel =
                    item.authorKind === "staff"
                      ? "Care team"
                      : isSelfFamily
                        ? "You"
                        : "Family";
                  const roleLabel = item.authorKind === "staff" ? "Care team" : "Family";
                  return (
                    <div key={item.id} className={`flex ${isRight ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                          isRight
                            ? "border-orange-200 bg-orange-50 text-stone-900"
                            : "border-stone-200 bg-stone-50 text-stone-900"
                        }`}
                      >
                        <p className="mb-1 text-xs font-semibold text-stone-600">
                          {authorLabel} · {roleLabel}
                        </p>
                        <p className="whitespace-pre-wrap">{item.body}</p>
                        <p className="mt-1 text-[11px] text-stone-500">{item.timeLabel}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="border-stone-200 bg-white text-stone-900">
            <CardContent className="space-y-2 p-3">
              <label className="sr-only" htmlFor="family-message-input">
                Message to care team
              </label>
              <textarea
                id="family-message-input"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message for the care team…"
                className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                disabled={!selectedResidentId || sending}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  className="inline-flex items-center bg-orange-600 text-white hover:bg-orange-500"
                  disabled={!selectedResidentId || sending || !draft.trim()}
                  onClick={() => void send()}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="ml-2">{sending ? "Sending…" : "Send"}</span>
                </Button>
                {loadError && residents.length > 0 ? (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-stone-600")}
                    onClick={() => selectedResidentId && void loadMessages(selectedResidentId)}
                  >
                    Refresh thread
                  </button>
                ) : null}
              </div>
              <p className="inline-flex items-center gap-1 text-xs text-stone-500">
                <MessageSquare className="h-3.5 w-3.5" />
                Up to 8,000 characters. Staff may reply from internal tools as this product surface expands.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
