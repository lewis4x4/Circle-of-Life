"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquare, Send, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchFamilyMessageResidents,
  fetchFamilyMessagesForResident,
  postFamilyMessage,
  type FamilyLinkedResidentOption,
  type FamilyMessageRow,
} from "@/lib/family/family-messages-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import {
  T8InboxThreaded,
  type T8QueueItem,
} from "@/design-system/templates/T8InboxThreaded";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type SupabaseDb = SupabaseClient<Database>;

export default function FamilyMessagesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [pageOpenedAt] = useState(() => new Date());
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [residents, setResidents] = useState<FamilyLinkedResidentOption[]>([]);
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
      } else {
        setResidents(result.residents);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load messaging.");
      setResidents([]);
    } finally {
      setLoadingResidents(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  if (configError) {
    return (
      <div
        role="alert"
        className={cn(
          "mx-auto mt-20 max-w-lg rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive",
        )}
      >
        {configError}
      </div>
    );
  }

  if (loadingResidents) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 py-48 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">Securing connection…</p>
      </div>
    );
  }

  if (loadError && residents.length === 0) {
    return (
      <div className="mx-auto mt-20 flex max-w-md flex-col gap-4 px-4 pb-16 text-center md:pb-0">
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive"
        >
          <MessageSquare
            className="mx-auto mb-3 h-8 w-8 text-destructive"
            aria-hidden="true"
          />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadResidents()}
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground",
            "transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
            "hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
        >
          Retry connection
        </button>
      </div>
    );
  }

  if (residents.length === 0) {
    return (
      <div className="mx-auto mt-20 max-w-md px-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-border bg-card px-4 py-8">
          <MessageSquare
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-foreground">
            No linked residents.
          </p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-muted-foreground">
            Messaging is not available until your account is linked to a
            resident.
          </p>
        </div>
      </div>
    );
  }

  const queue: T8QueueItem[] = residents.map((r) => ({
    id: r.id,
    title: r.displayName,
    meta: "Conversation",
  }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-6 md:pt-10">
      <T8InboxThreaded
        title="Messages"
        subtitle="A calm place to ask questions and share updates with the care team."
        queue={queue}
        initialSelectedId={residents[0]?.id}
        renderThread={(item) => (
          <ThreadDetail
            supabase={supabase}
            residentId={item?.id ?? null}
            residentName={item?.title ?? null}
            currentUserId={currentUserId}
          />
        )}
        contextRail={
          <section
            aria-label="Messaging visibility"
            className="rounded-lg border border-border bg-card"
          >
            <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-muted-foreground">
              Visibility
            </header>
            <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
              <p className="flex items-start gap-2 text-foreground">
                <ShieldCheck
                  className="mt-0.5 h-4 w-4 shrink-0 text-success"
                  aria-hidden="true"
                />
                <span>
                  Messages are private, time-stamped, and visible to the care
                  team.
                </span>
              </p>
              <p>
                Use messages for context and questions. Urgent medical concerns
                should still be directed to the facility right away.
              </p>
            </div>
          </section>
        }
        audit={{
          auditHref: "/family",
          updatedAt: pageOpenedAt,
          live: true,
        }}
      />
    </div>
  );
}

function ThreadDetail({
  supabase,
  residentId,
  residentName,
  currentUserId,
}: {
  supabase: SupabaseDb;
  residentId: string | null;
  residentName: string | null;
  currentUserId: string | null;
}) {
  const [messages, setMessages] = useState<FamilyMessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    if (!residentId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setError(null);
    try {
      const result = await fetchFamilyMessagesForResident(
        supabase,
        residentId,
      );
      if (!result.ok) {
        setError(result.error);
        setMessages([]);
      } else {
        setMessages(result.messages);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load messages.");
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(async () => {
    if (!residentId || sending) return;
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await postFamilyMessage(supabase, residentId, draft);
      if (!result.ok) {
        setError(result.error);
      } else {
        setDraft("");
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }, [residentId, draft, sending, supabase, refresh]);

  if (!residentId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a conversation to view messages.
      </p>
    );
  }

  return (
    <article
      aria-label={`Conversation: ${residentName ?? "Resident"}`}
      className="flex flex-col gap-4"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-caps text-muted-foreground">
            Conversation for
          </p>
          <h2 className="truncate text-base font-semibold text-foreground">
            {residentName ?? "Resident"}
          </h2>
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className={cn(
              "inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card px-2 text-xs font-medium text-muted-foreground",
              "transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
              "hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            )}
          >
            Refresh
          </button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {loadingMessages ? (
          <div
            className="flex items-center justify-center py-10 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <MessageSquare
              className="mb-3 h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              It&apos;s quiet here.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Send a message to the care team to start a thread.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const isSelfFamily =
                m.authorKind === "family" &&
                currentUserId != null &&
                m.authorUserId === currentUserId;
              const authorLabel =
                m.authorKind === "staff"
                  ? "Care Team"
                  : isSelfFamily
                    ? "You"
                    : "Family";
              return (
                <li
                  key={m.id}
                  className={cn(
                    "flex w-full flex-col gap-1",
                    isSelfFamily ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg border px-4 py-3 text-sm leading-relaxed sm:max-w-[70%]",
                      isSelfFamily
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-border bg-muted text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                  <p
                    className={cn(
                      "flex gap-2 text-xs text-muted-foreground",
                      isSelfFamily ? "justify-end" : "justify-start",
                    )}
                  >
                    <span className="font-medium text-foreground">
                      {authorLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{m.timeLabel}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <label
          htmlFor="family-message-input"
          className="text-xs font-semibold uppercase tracking-caps text-muted-foreground"
        >
          New message
        </label>
        <textarea
          id="family-message-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a secure message…"
          maxLength={8000}
          disabled={sending}
          className={cn(
            "w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-caps text-muted-foreground">
            Max 8,000 characters
          </p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border border-primary/30 bg-primary px-3 text-xs font-semibold text-primary-foreground",
              "transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
              "hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            <span>Send</span>
          </button>
        </div>
      </div>
    </article>
  );
}
