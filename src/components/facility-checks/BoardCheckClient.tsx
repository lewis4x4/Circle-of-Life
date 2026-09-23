"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  BOARD_CHECK_RESULTS,
  boardCheckClosedSummary,
  boardCheckFixAction,
  boardCheckProgress,
  boardCheckProgressLine,
  boardCheckResultInsert,
  boardCheckResultLabel,
  boardCloseRefusalMessage,
  groupBoardCheckRowsByRoom,
  havenOccupancyLabel,
  isBoardCheckResult,
  type BoardCheckResult,
  type BoardCheckRow,
} from "@/lib/facility-checks/board-check";
import type {
  BoardCheckHistoryEntry,
  BoardCheckSession,
} from "@/lib/facility-checks/load-board-check";

/**
 * Board Check — one tap per bed, walking the building with the census board.
 *
 * Three tiers. Tier 1 is the walk: a dense table grouped by room, because that
 * is the order Charlene moves in. Tier 2 is only the beds that disagree, each
 * with the one button into the flow that fixes it. Tier 3 is the whole history
 * of the session, superseded marks included.
 *
 * The close button is disabled from `board_check_state`, not from anything this
 * component tracks, and the database refuses the close a second time. A row
 * recomputes after a fix because the server re-reads it, never because a
 * control here decided the item was done.
 */
export function BoardCheckClient({
  session,
  initialRows,
  initialHistory,
  closedByName,
  loadError,
  facilityId,
  organizationId,
  actorId,
  residentsHref,
  onRefresh,
}: {
  session: BoardCheckSession | null;
  initialRows: BoardCheckRow[];
  initialHistory: BoardCheckHistoryEntry[];
  closedByName: string | null;
  loadError: string | null;
  facilityId: string | null;
  organizationId: string | null;
  actorId: string | null;
  residentsHref: string;
  onRefresh: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState(initialRows);
  const [history, setHistory] = useState(initialHistory);
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const closed = Boolean(session?.closedAt);
  const progress = useMemo(() => boardCheckProgress(rows), [rows]);
  const grouped = useMemo(() => groupBoardCheckRowsByRoom(rows), [rows]);
  const openFixes = useMemo(() => rows.filter((row) => row.fix_open), [rows]);

  /**
   * Re-read the walk from the database. The rows that come back carry the fix
   * state the server just recomputed, which is the only thing allowed to close
   * a fix item. Resident names are re-read alongside, so a bed admitted during
   * the walk shows the right person rather than the previous one.
   */
  const refresh = useCallback(async (): Promise<BoardCheckRow[] | null> => {
    if (!session) return null;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("board_check_state", { p_session_id: session.id });
    if (error) {
      setProblem("The bed list could not be reloaded. Refresh the page to see the current state.");
      return null;
    }
    const next = (data ?? []) as BoardCheckRow[];
    const residentIds = [...new Set(next.map((row) => row.haven_resident_id).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (residentIds.length > 0) {
      const { data: residents } = await supabase
        .from("residents")
        .select("id, first_name, last_name, preferred_name")
        .in("id", residentIds);
      for (const resident of residents ?? []) {
        const given = resident.preferred_name?.trim() || resident.first_name;
        names.set(resident.id, `${given} ${resident.last_name}`.trim());
      }
    }
    const reloaded = next.map((row) => ({
      ...row,
      residentName: row.haven_resident_id ? (names.get(row.haven_resident_id) ?? null) : null,
    }));
    setRows(reloaded);
    startTransition(() => {
      void onRefresh();
    });
    return reloaded;
  }, [onRefresh, session]);

  async function startSession() {
    if (!facilityId || !organizationId || !actorId) return;
    setStarting(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("board_check_sessions")
        .insert({ organization_id: organizationId, facility_id: facilityId, started_by: actorId } as never);
      if (error) throw error;
      startTransition(() => {
        void onRefresh();
      });
    } catch {
      setProblem("The check could not be started. Another walk may already be open for this facility.");
    } finally {
      setStarting(false);
    }
  }

  async function mark(row: BoardCheckRow, result: BoardCheckResult) {
    if (!session || !actorId || closed) return;
    setBusyBedId(row.bed_id);
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("board_check_results").insert(
        boardCheckResultInsert({
          organizationId: session.organizationId,
          sessionId: session.id,
          row,
          result,
          recordedBy: actorId,
        }) as never,
      );
      if (error) throw error;
      setHistory((current) => [
        {
          id: `${row.bed_id}-${current.length}`,
          bedId: row.bed_id,
          roomNumber: row.room_number,
          bedLabel: row.bed_label,
          result,
          recordedAt: new Date().toISOString(),
          recordedByName: null,
        },
        ...current,
      ]);
      await refresh();
    } catch {
      setProblem("That mark was not recorded. Try it again.");
    } finally {
      setBusyBedId(null);
    }
  }

  async function closeCheck() {
    if (!session) return;
    setClosing(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_board_check_session", { p_session_id: session.id });
      if (error) {
        // The database recounts before it refuses, so the screen was a moment
        // behind. Say what is left from what the re-read returned, not from the
        // rows this closure captured before the refusal.
        const reloaded = await refresh();
        setProblem(
          boardCloseRefusalMessage(boardCheckProgress(reloaded ?? rows)),
        );
        return;
      }
      toast.success("Board check closed.");
      startTransition(() => {
        void onRefresh();
      });
    } catch {
      setProblem("The check could not be closed. Refresh and try again.");
    } finally {
      setClosing(false);
    }
  }

  if (loadError) {
    return (
      <section aria-labelledby="board-check-heading" className="space-y-3">
        <h1 id="board-check-heading" className="text-base font-medium text-foreground">
          Board check
        </h1>
        <p className="text-sm text-muted-foreground">
          The bed list is not available right now. Try again in a moment.
        </p>
      </section>
    );
  }

  if (!session || (closed && rows.length === 0)) {
    return (
      <section aria-labelledby="board-check-heading" className="space-y-3">
        <h1 id="board-check-heading" className="text-base font-medium text-foreground">
          Board check
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Walk the building with the census board and mark each bed. The check closes only when every bed
          is marked and every disagreement has been corrected in Haven. It does not replace the physical
          fire census board.
        </p>
        <Button type="button" disabled={starting || !facilityId || !organizationId} onClick={() => void startSession()}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start board check"}
        </Button>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
      </section>
    );
  }

  const matched = rows.filter((row) => row.latest_result === "match").length;

  return (
    <section aria-labelledby="board-check-heading" className="space-y-6">
      <header className="space-y-1">
        <h1 id="board-check-heading" className="text-base font-medium text-foreground">
          Board check
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="board-check-progress">
          {closed && session.closedAt
            ? boardCheckClosedSummary({
                closedAt: session.closedAt,
                closedByName,
                total: rows.length,
                matched,
                formatDateTime: formatFacilityTimestampEt,
              })
            : boardCheckProgressLine(progress)}
        </p>
      </header>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm sm:min-w-[640px]">
          <caption className="sr-only">
            Every bed in this facility, grouped by room, with what Haven shows and what the board shows.
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Room and bed
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Haven shows
              </th>
              <th scope="col" className="py-2 font-medium">
                Board
              </th>
            </tr>
          </thead>
          {grouped.map((group) => (
            <tbody key={group.roomNumber}>
              {group.beds.map((row, index) => (
                <tr key={row.bed_id} className="border-b border-border align-top">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal text-foreground">
                    <span className="block font-medium">
                      {index === 0 ? `Room ${group.roomNumber}` : ""}
                    </span>
                    <span className="block text-muted-foreground">Bed {row.bed_label}</span>
                  </th>
                  <td className="py-2.5 pr-3 text-foreground">{havenOccupancyLabel(row)}</td>
                  <td className="py-2.5">
                    <fieldset disabled={closed || busyBedId === row.bed_id} className="flex flex-wrap gap-1.5">
                      <legend className="sr-only">
                        Board result for room {group.roomNumber} bed {row.bed_label}
                      </legend>
                      {BOARD_CHECK_RESULTS.map((result) => {
                        const selected = row.latest_result === result;
                        return (
                          <Button
                            key={result}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            aria-pressed={selected}
                            className="text-[12px]"
                            onClick={() => void mark(row, result)}
                          >
                            {boardCheckResultLabel(result)}
                          </Button>
                        );
                      })}
                    </fieldset>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {openFixes.length > 0 ? (
        <section aria-labelledby="board-check-fixes" className="space-y-3">
          <h3 id="board-check-fixes" className="text-sm font-medium text-foreground">
            What Haven needs
          </h3>
          <ul className="space-y-3">
            {openFixes.map((row) => {
              const action = boardCheckFixAction(row);
              if (!action) return null;
              return (
                <li key={row.bed_id} className="space-y-1 border-b border-border pb-3">
                  <p className="text-sm font-medium text-foreground">
                    Room {row.room_number}, bed {row.bed_label}
                  </p>
                  <p className="max-w-prose text-sm text-muted-foreground">{action.detail}</p>
                  <Link
                    href={
                      row.haven_resident_id
                        ? `${residentsHref}/${row.haven_resident_id}${action.kind === "move" ? "?changeBed=1" : ""}`
                        : residentsHref
                    }
                    className="inline-block text-sm text-foreground underline underline-offset-4"
                  >
                    {action.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="max-w-prose text-xs text-muted-foreground">
            Each item clears when Haven agrees with the board. Nothing here is ticked off by hand.
          </p>
        </section>
      ) : null}

      {!closed ? (
        <div className="space-y-2">
          <Button type="button" disabled={!progress.canClose || closing} onClick={() => void closeCheck()}>
            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Close check"}
          </Button>
          {!progress.canClose ? (
            <p className="text-xs text-muted-foreground">{boardCloseRefusalMessage(progress)}</p>
          ) : null}
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-foreground">Session history</summary>
        <ul className="mt-3 space-y-2">
          {history.map((entry) => (
            <li key={entry.id} className="text-muted-foreground">
              Room {entry.roomNumber}, bed {entry.bedLabel} ·{" "}
              {isBoardCheckResult(entry.result) ? boardCheckResultLabel(entry.result) : entry.result} ·{" "}
              {formatFacilityTimestampEt(entry.recordedAt)}
              {entry.recordedByName ? ` · ${entry.recordedByName}` : ""}
            </li>
          ))}
          {history.length === 0 ? <li className="text-muted-foreground">No beds marked yet.</li> : null}
        </ul>
      </details>
    </section>
  );
}

export default BoardCheckClient;
