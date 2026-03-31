"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, MessageCircle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { StaffMessageRow, StaffMessageThread } from "@/lib/admin/family-messages-data";
import {
  fetchStaffMessageThreads,
  fetchStaffMessagesForResident,
  postStaffMessage,
} from "@/lib/admin/family-messages-data";

export default function StaffFamilyMessagesPage() {
  const [threads, setThreads] = useState<StaffMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StaffMessageRow[]>([]);
  const [residentName, setResidentName] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      const result = await postStaffMessage(supabase, selectedResidentId, draft);
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
  }, [selectedResidentId, draft, sending, openThread]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 py-12 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" onClick={loadThreads}>Retry</Button>
      </div>
    );
  }

  if (selectedResidentId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedResidentId(null);
              setMessages([]);
              void loadThreads();
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">
            Messages — {residentName}
          </h2>
        </div>

        {msgLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : msgError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-400">{msgError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => openThread(selectedResidentId)}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">No messages yet.</p>
              ) : (
                messages.map((m) => {
                  const isStaff = m.authorKind === "staff";
                  return (
                    <div key={m.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
                          isStaff
                            ? "bg-blue-600 text-white"
                            : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        <p className={`text-xs font-medium ${isStaff ? "text-blue-100" : "text-zinc-500 dark:text-zinc-400"}`}>
                          {m.authorName} · {m.createdAt}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex gap-2">
              <textarea
                placeholder="Type your reply to the family…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={8000}
                rows={2}
                className="flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <Button
                onClick={handleSend}
                disabled={!draft.trim() || sending}
                className="h-auto self-end"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-right text-xs text-zinc-400">{draft.length}/8000 · Cmd+Enter to send</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Family Messages</h1>
        <p className="text-sm text-zinc-500">Conversations with families about their residents</p>
      </div>

      {threads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm text-zinc-500">No family messages yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.residentId}
              className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              onClick={() => openThread(t.residentId)}
            >
              <CardHeader className="pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{t.residentName}</CardTitle>
                    <CardDescription>{t.roomLabel}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.unreadHint && (
                      <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        Family replied
                      </Badge>
                    )}
                    <span className="text-xs text-zinc-400">{t.lastMessageAt}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium">{t.lastAuthorKind === "staff" ? "You" : "Family"}:</span>{" "}
                  {t.lastMessageBody}
                </p>
                <p className="mt-1 text-xs text-zinc-400">{t.messageCount} message{t.messageCount !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
