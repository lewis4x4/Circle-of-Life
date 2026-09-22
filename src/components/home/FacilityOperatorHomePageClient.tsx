"use client";

import Link from "next/link";
import { Activity, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { loadHome, type HomeInitialData } from "@/lib/home/load-home";
import { claimHomeTask, fetchHomeOnTap } from "@/lib/home/on-tap";
import {
  buildFyiRows,
  coOperatorLine,
  dueBeforeYouLeaveCount,
  escalationFooter,
  formatLocalDateLong,
  greetingLine,
  rankOnTap,
  type HomeRowAction,
} from "@/lib/home/on-tap-model";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { FacilityRoundingCard } from "./FacilityRoundingCard";
import { GlanceStrip } from "./GlanceStrip";
import { CARD_CLASS, CARD_HEAD_CLASS, LINK_BUTTON_CLASS } from "./home-styles";
import { ClearedRow, OnTapRow } from "./OnTapRow";
import { PresenceTiles } from "./PresenceTiles";
import { QuickActions } from "./QuickActions";

export type FacilityOperatorHomePageClientProps = {
  initial: HomeInitialData;
  initialFacilityId: string;
  currentUserId: string;
  fullName: string | null;
};

const REFRESH_TICK_MS = 60_000;

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

/**
 * Facility Operator Home (COL-593). One facility per view; the top-bar chip is
 * the switcher for people with more than one building. Every row on tap can be
 * claimed and cleared here; completions go through the operations completion
 * route so the audit row and the dual-sign rules stay exactly as they are.
 */
export function FacilityOperatorHomePageClient({ initial, initialFacilityId, currentUserId, fullName }: FacilityOperatorHomePageClientProps) {
  const { organizationId, loading: authLoading } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const [data, setData] = useState<HomeInitialData>(initial);
  const [facilityId, setFacilityId] = useState(initialFacilityId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const supabase = () => (supabaseRef.current ??= createClient());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), REFRESH_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const reloadFeed = useCallback(async (targetFacilityId: string) => {
    try {
      const feed = await fetchHomeOnTap(supabase(), targetFacilityId);
      setData((current) => ({ ...current, feed }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The queue could not be refreshed.");
    }
  }, []);

  // The top-bar facility chip is the switcher: re-fetch when it changes to
  // another building the caller can see. Null means "all"; Home stays on the
  // building it was rendered for.
  useEffect(() => {
    if (authLoading || !organizationId) return;
    if (!selectedFacilityId || selectedFacilityId === facilityId) return;
    if (!data.facilityOptions.some((option) => option.id === selectedFacilityId)) return;
    let cancelled = false;
    setLoading(true);
    loadHome(supabase(), { facilityId: selectedFacilityId, organizationId })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setFacilityId(selectedFacilityId);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Home could not load this building.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, organizationId, selectedFacilityId, facilityId, data.facilityOptions]);

  const fyi = useMemo(() => (data.snapshot ? buildFyiRows(data.snapshot.workflowQueues) : []), [data.snapshot]);
  const ranked = useMemo(() => rankOnTap({ feed: data.feed, fyi, now, currentUserId }), [data.feed, fyi, now, currentUserId]);
  const dueCount = dueBeforeYouLeaveCount(ranked);
  const feed = data.feed;
  const coLine = coOperatorLine(feed);
  const endOfDay = (() => {
    const [hh, mm] = feed.endOfDayLocal.split(":");
    const hour = Number(hh);
    return `${((hour + 11) % 12) + 1}:${mm} ${hour >= 12 ? "PM" : "AM"}`;
  })();
  const executiveFirst = feed.escalatesTo?.displayName?.split(/\s+/)[0] ?? null;

  const onClaim = useCallback(async (instanceId: string, claim: boolean) => {
    setBusyRow(instanceId);
    try {
      await claimHomeTask(supabase(), instanceId, claim);
      await reloadFeed(facilityId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The claim could not be saved.");
    } finally {
      setBusyRow(null);
    }
  }, [facilityId, reloadFeed]);

  const onClear = useCallback(async (instanceId: string, action: HomeRowAction, note: string) => {
    setBusyRow(instanceId);
    try {
      const body: Record<string, string> = {};
      if (action.key === "ran" || action.key === "did_not_run") body.outcome = action.key;
      if (note) body.completion_notes = note;
      const response = await fetch(`/api/admin/operations/tasks/${instanceId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "The row could not be cleared. Refresh and retry.");
      }
      await reloadFeed(facilityId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The row could not be cleared.");
    } finally {
      setBusyRow(null);
    }
  }, [facilityId, reloadFeed]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 lg:px-8" data-testid="facility-operator-home">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{greetingLine(fullName)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{formatLocalDateLong(feed.localDate, feed.timezone)}</span>
            <span className="mx-1.5 text-border">·</span>
            {feed.facilityName}
            <span className="mx-1.5 text-border">·</span>
            <span className="font-medium text-foreground" data-testid="on-tap-count">{dueCount} on tap</span> before you leave
            {coLine ? (
              <>
                <span className="mx-1.5 text-border">·</span>
                {coLine}
              </>
            ) : null}
          </p>
        </div>
        {data.snapshot ? (
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground">
            <Activity className="size-3" aria-hidden />
            <span className="text-foreground">{data.snapshot.shiftSummary.split(" · ")[0]}</span>
            <span className="text-border">·</span>
            {formatTime(now.toISOString(), feed.timezone)} · {feed.timezone}
          </span>
        ) : null}
      </header>

      <QuickActions />

      <GlanceStrip
        counts={ranked.counts}
        rentLive={false}
        rightNote={`Due before you leave · uncleared goes to ${executiveFirst ?? "the Facility Executive"} at ${endOfDay}`}
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <section className={cn(CARD_CLASS, "overflow-hidden", loading && "opacity-60")} aria-labelledby="on-tap-heading" aria-busy={loading}>
          <div className={CARD_HEAD_CLASS}>
            <div>
              <h2 id="on-tap-heading" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
                <Activity className="size-4 text-muted-foreground" aria-hidden />
                On tap today
                <span className="inline-flex h-5 items-center gap-1 rounded border border-destructive/40 bg-card px-1.5 text-[11px] font-semibold text-foreground tabular-nums">
                  <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
                  {dueCount} due
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ranked: regulatory &amp; safety → assigned → FYI. Seven at a time; the rest sit under “Later.” Nothing is generated on Saturday or Sunday.
              </p>
            </div>
            <Link href={`/admin/operations/work?facility_id=${facilityId}`} className={LINK_BUTTON_CLASS}>Open Operations →</Link>
          </div>

          {ranked.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="on-tap-empty">
              {feed.isWeekend
                ? "Nothing is on tap on Saturday or Sunday. The queue opens again Monday."
                : "Nothing is on tap right now. Cleared rows stay below until midnight."}
            </p>
          ) : (
            <ol className="list-none">
              {ranked.rows.map((row, index) => (
                <OnTapRow
                  key={row.id}
                  row={row}
                  position={index + 1}
                  currentUserId={currentUserId}
                  busy={busyRow === row.instanceId}
                  onClaim={onClaim}
                  onClear={onClear}
                />
              ))}
            </ol>
          )}

          {feed.cleared.length > 0 ? (
            <ul className="list-none border-t border-border/60" aria-label="Cleared today">
              {feed.cleared.map((row) => (
                <ClearedRow
                  key={row.id}
                  title={row.title}
                  meta={[
                    `Cleared ${row.completedAt ? formatTime(row.completedAt, feed.timezone) : ""}${row.completedBy ? ` · ${row.completedBy}` : ""}`.trim(),
                    ...(row.completionNotes ? [row.completionNotes] : ["Receipt on file"]),
                  ]}
                />
              ))}
            </ul>
          ) : null}

          <details className="group border-t border-border/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
              <span data-testid="later-summary">Later this week · {ranked.later.length}</span>
            </summary>
            {ranked.later.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-muted-foreground">Nothing scheduled for the next seven days.</p>
            ) : (
              <ol className="list-none">
                {ranked.later.map((row, index) => (
                  <OnTapRow
                    key={row.id}
                    row={row}
                    position={ranked.rows.length + index + 1}
                    currentUserId={currentUserId}
                    busy={busyRow === row.instanceId}
                    onClaim={onClaim}
                    onClear={onClear}
                  />
                ))}
              </ol>
            )}
          </details>

          <p className="border-t border-border/60 bg-background/60 px-4 py-2.5 text-xs text-muted-foreground">{escalationFooter(feed)}</p>
        </section>

        <div className="flex flex-col gap-4">
          <PresenceTiles
            presence={data.presence}
            available={data.presenceAvailable}
            licensedBeds={data.snapshot?.licensedBeds ?? null}
            standUpCensus={data.standUpCensus}
          />
          <FacilityRoundingCard facilityId={facilityId} facilityName={feed.facilityName} timeZone={feed.timezone} rounding={data.rounding} />
        </div>
      </div>
    </div>
  );
}
