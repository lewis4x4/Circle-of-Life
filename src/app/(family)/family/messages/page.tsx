"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchFamilyMessageResidents,
  fetchFamilyMessagesForResident,
  type FamilyLinkedResidentOption,
  type FamilyMessageRow,
} from "@/lib/family/family-messages-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";
import { FamilyPortalUpdateLog } from "@/components/family-portal/FamilyPortalUpdateLog";

type SupabaseDb = SupabaseClient<Database>;

export default function FamilyMessagesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [residents, setResidents] = useState<FamilyLinkedResidentOption[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);

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
      const result = await fetchFamilyMessageResidents(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setResidents([]);
      } else {
        setResidents(result.residents);
        setSelectedResidentId((current) => current ?? result.residents[0]?.id ?? null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load updates.");
      setResidents([]);
    } finally {
      setLoadingResidents(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const selectedResident = residents.find((resident) => resident.id === selectedResidentId) ?? null;

  if (configError) {
    return (
      <div
        role="alert"
        className="mx-auto mt-20 max-w-lg rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive"
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Loading care team updates…</p>
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
          Retry
        </button>
      </div>
    );
  }

  if (residents.length === 0) {
    return (
      <div className="mx-auto mt-20 max-w-md px-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-border bg-card px-4 py-8">
          <p className="text-sm font-semibold text-foreground">No linked residents</p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-muted-foreground">
            Care team updates are not available until your account is linked to a resident.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-16 pt-8 md:pb-0">
      <FamilySectionIntro
        active="updates"
        title="Care team updates"
        description="Read-only notes from your care team. This portal does not support replies."
        residentSummary={
          residents.length === 1 ? residents[0]?.displayName : undefined
        }
      />

      {residents.length > 1 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {residents.map((resident) => {
            const active = resident.id === selectedResidentId;
            return (
              <button
                key={resident.id}
                type="button"
                onClick={() => setSelectedResidentId(resident.id)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  active
                    ? "border-border bg-card text-foreground shadow-sm"
                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-current={active ? "true" : undefined}
              >
                {resident.displayName}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <ResidentUpdateLog
          supabase={supabase}
          residentId={selectedResidentId}
          residentName={selectedResident?.displayName ?? null}
        />

        <aside
          aria-label="Update visibility"
          className="h-fit rounded-lg border border-border bg-card"
        >
          <header className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            About these updates
          </header>
          <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
            <p className="flex items-start gap-2 text-foreground">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                aria-hidden="true"
              />
              <span>
                Updates are private, time-stamped, and posted by the care team.
              </span>
            </p>
            <p>
              For urgent medical concerns, contact the facility directly by phone.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ResidentUpdateLog({
  supabase,
  residentId,
  residentName,
}: {
  supabase: SupabaseDb;
  residentId: string | null;
  residentName: string | null;
}) {
  const [messages, setMessages] = useState<FamilyMessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!residentId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setError(null);
    try {
      const result = await fetchFamilyMessagesForResident(supabase, residentId);
      if (!result.ok) {
        setError(result.error);
        setMessages([]);
      } else {
        setMessages(result.messages);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load updates.");
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!residentId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a resident to view care team updates.
      </p>
    );
  }

  return (
    <section aria-label={`Care team updates for ${residentName ?? "resident"}`}>
      <header className="mb-4 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground">Updates for</p>
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-lg font-medium text-foreground">
            {residentName ?? "Resident"}
          </h2>
          {error ? (
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Refresh
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      <FamilyPortalUpdateLog
        loading={loadingMessages}
        items={[...messages].reverse().map((message) => ({
          id: message.id,
          body: message.body,
          timestamp: message.timeLabel,
          authorLabel: "Care team",
          variant: "staff" as const,
        }))}
        emptyTitle="No updates yet"
        emptyDescription="When the care team posts a note, it will appear here."
        listLabel="Posted updates"
      />
    </section>
  );
}
