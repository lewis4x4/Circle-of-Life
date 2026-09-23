"use client";

/**
 * Watchlist tier 3: one resident. Spec 25A section 7.5.
 *
 * The full signal history, the disposition ledger, and for each open signal the
 * rows behind it: the evidence payload names the incidents, logs or orders that
 * fired the rule, so a reviewer can open what the system saw rather than take
 * its word for it.
 *
 * Nothing on this page is a score. The band is a word and it comes from the
 * band rules, not from arithmetic performed here.
 */

import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format/datetime";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { RoundingHubNav } from "../../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { WatchlistDispositionForm } from "@/components/rounding/WatchlistDispositionForm";
import {
  type LedgerEntry,
  WatchlistDispositionLedger,
} from "@/components/rounding/WatchlistDispositionLedger";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  formatSignalEvidence,
  isDocumentationSignal,
  resolveWatchlistFacilityScope,
  residentDisplayName,
  signalStatusLabel,
  signalStatusTone,
  SIGNAL_HISTORY_EMPTY_STATE,
  sourceKindLabel,
} from "@/lib/rounding/watchlist-display-copy";
import {
  fetchFacilityWatchlist,
  fetchWatchlistObservationEvidence,
  type WatchlistObservationEvidence,
  fetchResidentDispositionLedger,
  fetchResidentWatchlistSignals,
  type WatchlistSignalHistoryRow,
  type WatchlistSignalRow,
} from "@/lib/rounding/watchlist-fetch";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

const LOAD_FAILED = "This resident's Watchlist record could not be loaded. Try again in a moment.";

/**
 * What fired the signal, in sentences. The payload names rows by id so the
 * signal is auditable, but a uuid list on a resident record is developer text
 * and never renders here.
 */
function EvidenceLines({
  signalKey,
  evidence,
}: {
  signalKey: string;
  evidence: Record<string, unknown> | null;
}) {
  const lines = formatSignalEvidence(signalKey, evidence);
  if (lines.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        The records behind this signal are not summarized yet. Open the observation log and the
        incident history for this resident to see the underlying entries.
      </p>
    );
  }
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-[13px] font-medium text-foreground">What fired this</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <li key={line} className="text-[13px] text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ResidentWatchlistPage({
  params,
}: {
  params: Promise<{ residentId: string }>;
}) {
  const { residentId } = use(params);
  const { selectedFacilityId } = useFacilityStore();
  return <ScopedResidentWatchlist key={`${selectedFacilityId}:${residentId}`} residentId={residentId} />;
}

function ScopedResidentWatchlist({ residentId }: { residentId: string }) {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find(
    (facility) => facility.id === selectedFacilityId,
  );
  const facilityScope = resolveWatchlistFacilityScope(selectedFacilityId, selectedFacility?.name);
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);

  const [open, setOpen] = useState<WatchlistSignalRow[]>([]);
  const [history, setHistory] = useState<WatchlistSignalHistoryRow[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);
  const [observations, setObservations] = useState<WatchlistObservationEvidence[]>([]);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const attempt = ++generation.current;
    if (!selectedFacilityId) { setLoading(false); return; }
    if (!isBrowserSupabaseConfigured()) { setFailed(true); setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    try {
      const [board, signalHistory, transitions] = await Promise.all([
        selectedFacilityId
          ? fetchFacilityWatchlist(supabase, selectedFacilityId)
          : Promise.resolve([] as WatchlistSignalRow[]),
        fetchResidentWatchlistSignals(supabase, residentId, selectedFacilityId),
        fetchResidentDispositionLedger(supabase, residentId, selectedFacilityId),
      ]);

      if (attempt !== generation.current) return;
      const logIds = [...new Set(signalHistory.flatMap((row) => evidenceLogIds(row.evidence)))];
      const entries = await fetchWatchlistObservationEvidence(supabase, residentId, selectedFacilityId, logIds);
      if (attempt !== generation.current) return;
      setObservations(entries);
      setHasData(true);
      const mine = board.filter((row) => row.resident_id === residentId);
      // A cleared signal is off the board but still in the ledger, so the label
      // map uses the configured human-readable label even after clearing.
      const labelFor = new Map(signalHistory.map((row) => [row.signal_key, row.signal_label]));
      for (const row of mine) labelFor.set(row.signal_key, row.signal_label);

      setOpen(mine);
      setHistory(signalHistory);
      setLedger(
        transitions.map((row) => ({
          id: row.id,
          acted_at: row.acted_at,
          resident_name: mine[0] ? residentDisplayName(mine[0]) : "This resident",
          room_number: mine[0]?.room_number ?? null,
          signal_label: labelFor.get(row.signal_key) ?? "Watchlist signal",
          from_status: row.from_status,
          to_status: row.to_status,
          acted_by_name: row.acted_by_name,
          acted_by_role: row.acted_by_role,
          note: row.note,
          actor_kind: row.actor_kind,
        })),
      );
    } catch {
      if (attempt === generation.current) setFailed(true);
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }, [supabase, residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
    // This counter invalidates requests; it is not a captured DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; };
  }, [load]);

  const heading = open[0] ? residentDisplayName(open[0]) : "Resident watchlist";
  const band = open[0]?.band_label ?? null;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title={heading}
        subtitle={
          band
            ? `Band: ${band}. Every signal open against this resident, what was done about each, and the records behind them.`
            : "Every signal recorded against this resident, what was done about each, and the records behind them."
        }
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh this resident's record"
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        }
      />

      <RoundingHubNav />

      <Link
        href="/admin/rounding/watchlist"
        className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to the Watchlist
      </Link>

      {failed ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-[13px] text-foreground">{LOAD_FAILED}{hasData ? " Showing the last successfully loaded records." : ""}</p>
        </div>
      ) : null}

      {!selectedFacilityId ? (
        <FacilityGateNotice reason="A resident's watchlist record is read inside the building that holds it." />
      ) : null}
      {loading ? <p role="status">{hasData ? "Refreshing resident record…" : "Loading resident record…"}</p> : null}
      {hasData ? <>
      <section aria-label="Open signals" className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Open signals</h2>
        {open.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground">Nothing is open right now.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              A signal appears here when a rule in the signal list is met against this resident.
            </p>
          </div>
        ) : (
          open.map((signal) => (
            <article
              key={signal.signal_instance_id}
              className="space-y-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{signal.signal_label}</p>
                <StatusPill tone={signalStatusTone(signal.status)}>
                  {signalStatusLabel(signal.status)}
                </StatusPill>
                <StatusPill tone={isDocumentationSignal(signal.source_kind) ? "info" : "muted"}>
                  {sourceKindLabel(signal.source_kind)}
                </StatusPill>
              </div>
              <p className="text-[13px] text-muted-foreground">{signal.signal_description}</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">First seen</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatDisplayDate(signal.first_detected_at)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Times matched</dt>
                  <dd className="tabular-nums text-foreground">{signal.observed_count}</dd>
                </div>
              </dl>
              <EvidenceLines signalKey={signal.signal_key} evidence={signal.evidence} />
              <ObservationEvidence evidence={signal.evidence} observations={observations} />
              <WatchlistDispositionForm
                supabase={supabase}
                signalInstanceId={signal.signal_instance_id}
                currentStatus={signal.status}
                onRecorded={() => void load()}
              />
            </article>
          ))
        )}
      </section>

      <section aria-label="Signal history" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Signal history</h2>
        {history.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground">
              {SIGNAL_HISTORY_EMPTY_STATE.title}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {SIGNAL_HISTORY_EMPTY_STATE.body}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <HorizontalScroll label="Watchlist history">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5">Signal</th>
                    <th className="px-3 py-2.5">Opened</th>
                    <th className="px-3 py-2.5">Closed</th>
                    <th className="px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((row) => (
                    <tr key={row.id} className="h-9">
                      <td className="px-3 py-2 text-[13px] text-foreground">{row.signal_label}<ObservationEvidence evidence={row.evidence} observations={observations} /></td>
                      <td className="px-3 py-2 text-[13px] tabular-nums text-muted-foreground">
                        {formatDisplayDate(row.first_detected_at)}
                      </td>
                      <td className="px-3 py-2 text-[13px] tabular-nums text-muted-foreground">
                        {row.cleared_at ? formatDisplayDate(row.cleared_at) : "Open"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone={signalStatusTone(row.status)}>
                          {signalStatusLabel(row.status)}
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScroll>
          </div>
        )}
      </section>

      <WatchlistDispositionLedger entries={ledger} facilityScope={facilityScope} />
      </> : null}
    </div>
  );
}

function evidenceLogIds(evidence: Record<string, unknown> | null): string[] {
  return Array.isArray(evidence?.log_ids) ? evidence.log_ids.filter((id): id is string => typeof id === "string") : [];
}

function ObservationEvidence({ evidence, observations }: {
  evidence: Record<string, unknown> | null; observations: WatchlistObservationEvidence[];
}) {
  const ids = evidenceLogIds(evidence);
  if (!ids.length) return null;
  const entries = observations.filter((row) => ids.includes(row.id));
  return <details className="mt-2 rounded-md border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">View underlying observations</summary>
    {entries.length < ids.length ? <p className="mt-2 text-sm text-muted-foreground">Some referenced observations are unavailable in this building or with your access.</p> : null}
    <ul className="mt-2 space-y-3">{entries.map((row) => <li key={row.id}>
      <time className="text-xs text-muted-foreground" dateTime={row.observed_at}>{formatDisplayDateTime(row.observed_at)}</time>
      <p className="text-sm">{row.composed_summary || "Observation narrative unavailable."}</p>
      {row.note ? <p className="text-sm text-muted-foreground">Note: {row.note}</p> : null}
    </li>)}</ul>
  </details>;
}
