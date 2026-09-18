"use client";

/**
 * The Live board's reads, in one place.
 *
 * Split out of the board component for two reasons. The board stays inside the
 * constitution's component budget, and more importantly the cadence read is
 * deliberately in its own `try`: a cadence header that cannot load must not
 * take the checks off the screen. Decision D23's lesson is that one failing
 * read taking a whole tab down is how three unrelated query defects hid behind
 * a single sentence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { facilityDateIsoDaysFromToday, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import {
  LIVE_BOARD_SERVICE_DATE_SPAN_DAYS,
  fetchLiveBoardEscalations,
  fetchLiveBoardRoster,
  fetchLiveBoardShifts,
  fetchLiveBoardTasks,
  fetchLiveBoardWindows,
  type LiveBoardEscalationRow,
  type LiveBoardRosterRow,
  type LiveBoardShiftRow,
  type LiveBoardTaskRow,
  type LiveBoardWindowRow,
} from "@/lib/rounding/live-board-fetch";
import type { LiveBoardLoadState } from "@/lib/rounding/live-board-state";
import { logRoundingQueryFailure } from "@/lib/rounding/rounding-query-error";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

const AUTO_REFRESH_INTERVAL_MS = 30_000;

export const LIVE_BOARD_LOAD_FAILED_COPY =
  "The board could not be loaded. Retry, or try again in a moment.";

export type LiveBoardData = {
  loadState: LiveBoardLoadState;
  tasks: LiveBoardTaskRow[];
  roster: LiveBoardRosterRow[];
  escalations: LiveBoardEscalationRow[];
  windows: LiveBoardWindowRow[];
  shifts: LiveBoardShiftRow[];
  cadenceUnavailable: boolean;
  errorMessage: string | null;
  reload: () => void;
  markCompleted: (taskId: string) => void;
};

export function useLiveBoardData(selectedFacilityId: string | null): LiveBoardData {
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [loadState, setLoadState] = useState<LiveBoardLoadState>("idle");
  const [tasks, setTasks] = useState<LiveBoardTaskRow[]>([]);
  const [roster, setRoster] = useState<LiveBoardRosterRow[]>([]);
  const [escalations, setEscalations] = useState<LiveBoardEscalationRow[]>([]);
  const [windows, setWindows] = useState<LiveBoardWindowRow[]>([]);
  const [shifts, setShifts] = useState<LiveBoardShiftRow[]>([]);
  const [cadenceUnavailable, setCadenceUnavailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setTasks([]);
      setRoster([]);
      setEscalations([]);
      setWindows([]);
      setShifts([]);
      setLoadState("ready");
      loadingRef.current = false;
      return;
    }

    const serviceDate = todayFacilityDateIso();
    const fromServiceDate = facilityDateIsoDaysFromToday(-LIVE_BOARD_SERVICE_DATE_SPAN_DAYS);

    try {
      const [taskRows, rosterRows, escalationRows] = await Promise.all([
        fetchLiveBoardTasks(supabase, selectedFacilityId, fromServiceDate, serviceDate),
        fetchLiveBoardRoster(supabase, selectedFacilityId),
        fetchLiveBoardEscalations(supabase, selectedFacilityId),
      ]);
      setTasks(taskRows);
      setRoster(rosterRows);
      setEscalations(escalationRows);
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(
        logRoundingQueryFailure("rounding.live_board.load", error, LIVE_BOARD_LOAD_FAILED_COPY),
      );
      setTasks([]);
      setRoster([]);
      setEscalations([]);
      setLoadState("error");
    }

    try {
      const [windowRows, shiftRows] = await Promise.all([
        fetchLiveBoardWindows(supabase, selectedFacilityId, serviceDate),
        fetchLiveBoardShifts(supabase, selectedFacilityId),
      ]);
      setWindows(windowRows);
      setShifts(shiftRows);
      setCadenceUnavailable(false);
    } catch (error) {
      logRoundingQueryFailure("rounding.live_board.cadence", error, LIVE_BOARD_LOAD_FAILED_COPY);
      setWindows([]);
      setShifts([]);
      setCadenceUnavailable(true);
    }

    loadingRef.current = false;
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    setLoadState("loading");
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedFacilityId) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, selectedFacilityId]);

  const markCompleted = useCallback((taskId: string) => {
    setTasks((previous) =>
      previous.map((task) =>
        task.id === taskId ? { ...task, status: "completed_on_time" } : task,
      ),
    );
  }, []);

  return {
    loadState,
    tasks,
    roster,
    escalations,
    windows,
    shifts,
    cadenceUnavailable,
    errorMessage,
    reload: () => void load(),
    markCompleted,
  };
}
