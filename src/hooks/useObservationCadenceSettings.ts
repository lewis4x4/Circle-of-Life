"use client";

/**
 * All the state and every command the cadence settings surface issues.
 * Spec 25A section 6.
 *
 * The surface is a read, an editor, a preview and five commands. Holding all of
 * that in the page pushed it past the size the constitution allows, so it lives
 * here and the display sections stay display only.
 *
 * The flow is propose, preview, then put in force, which is spec 6.12's own
 * model. It also means the preview is computed from the saved proposal by the
 * same command the activation acts on, rather than from a second copy of the
 * window arithmetic in the browser.
 */

import { formatDisplayDateTime } from "@/lib/format/datetime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  draftsDiffer,
  rungDraftsFrom,
  windowDraftsFrom,
  type ApplyMode,
  type ChangeLogEntry,
  type ConfigurationSnapshot,
  type ObservationConfigOverview,
  type RungDraft,
  type SimulationResult,
  type WindowDraft,
} from "@/lib/rounding/cadence-settings";
import {
  CADENCE_SETTINGS_LOAD_FAILED,
  CHANGE_LOG_LOAD_FAILED,
} from "@/lib/rounding/cadence-settings-copy";
import {
  activateCadenceVersion,
  createCadenceVersion,
  fetchObservationConfigChangeLog,
  fetchObservationConfigOverview,
  rollbackCadenceVersion,
  sendTestEscalation,
  simulateCadenceChange,
} from "@/lib/rounding/cadence-settings-fetch";
import {
  logRoundingQueryFailure,
  roundingCommandRefusal,
} from "@/lib/rounding/rounding-query-error";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

export type CadenceLoadState = "idle" | "loading" | "ready" | "error";
export type CadenceProposal = { cadenceVersionId: string | null; escalationVersionId: string | null };

export function useObservationCadenceSettings(facilityId: string) {
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);

  const loadGeneration = useRef(0);
  const [overview, setOverview] = useState<ObservationConfigOverview | null>(null);
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [loadState, setLoadState] = useState<CadenceLoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [windowDrafts, setWindowDrafts] = useState<WindowDraft[]>([]);
  const [rungDrafts, setRungDrafts] = useState<RungDraft[]>([]);
  const [configurationDraft, setConfigurationDraft] = useState<ConfigurationSnapshot | null>(null);
  const [proposalReason, setProposalReason] = useState("");

  const [proposal, setProposal] = useState<CadenceProposal | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [activationReason, setActivationReason] = useState("");
  const [applyMode, setApplyMode] = useState<ApplyMode>("next_shift_boundary");
  const [scheduledFor, setScheduledFor] = useState("");
  const [acknowledgment, setAcknowledgment] = useState("");
  const [busy, setBusy] = useState(false);
  const [testSendRungKey, setTestSendRungKey] = useState<string | null>(null);

  const load = useCallback(
    async (withProposal: CadenceProposal | null) => {
      const generation = ++loadGeneration.current;
      setErrorMessage(null);
      if (!facilityId || !isBrowserSupabaseConfigured()) {
        setOverview(null);
        setLoadState("ready");
        return;
      }

      setLoadState("loading");
      try {
        const next = await fetchObservationConfigOverview(supabase, facilityId, withProposal ?? undefined);
        if (generation !== loadGeneration.current) return;
        setOverview(next);
        if (withProposal == null) {
          setConfigurationDraft(next.configuration ?? null);
          setWindowDrafts(windowDraftsFrom(next.current.day_shape));
          setRungDrafts(rungDraftsFrom(next.current.ladder));
        }
        setLoadState("ready");
      } catch (error) {
        if (generation !== loadGeneration.current) return;
        setErrorMessage(
          logRoundingQueryFailure("rounding.cadence_settings.overview", error, CADENCE_SETTINGS_LOAD_FAILED),
        );
        setLoadState("error");
        return;
      }

      try {
        const entries = await fetchObservationConfigChangeLog(supabase, facilityId);
        if (generation !== loadGeneration.current) return;
        setChangeLog(entries);
      } catch (error) {
        if (generation !== loadGeneration.current) return;
        setErrorMessage(
          logRoundingQueryFailure("rounding.cadence_settings.change_log", error, CHANGE_LOG_LOAD_FAILED),
        );
      }
    },
    [facilityId, supabase],
  );

  useEffect(() => {
    setOverview(null);
    setChangeLog([]);
    setProposal(null);
    setSimulation(null);
    setNotice(null);
    void load(null);
    return () => { loadGeneration.current += 1; };
  }, [load]);

  // The drafts are compared against the rows in force, so the memo keys on the
  // whole overview. Keying on the nested shape looks tighter and is wrong: the
  // nested object is replaced on every reload, so the lint rule is right that
  // the dependency is the overview itself.
  const originalWindows = useMemo(() => windowDraftsFrom(overview?.current.day_shape ?? null), [overview]);
  const originalRungs = useMemo(() => rungDraftsFrom(overview?.current.ladder ?? []), [overview]);
  const configurationChanged = JSON.stringify(configurationDraft) !== JSON.stringify(overview?.configuration ?? null);
  const windowsChanged = draftsDiffer(windowDrafts, originalWindows);
  const rungsChanged = draftsDiffer(rungDrafts, originalRungs);

  const resetDrafts = useCallback(() => {
    setConfigurationDraft(overview?.configuration ?? null);
    setWindowDrafts(originalWindows);
    setRungDrafts(originalRungs);
    setProposalReason("");
    setProposal(null);
    setSimulation(null);
    setActivationReason("");
    setAcknowledgment("");
  }, [originalRungs, originalWindows, overview]);

  const runCommand = useCallback(
    async (step: string, fallback: string, action: () => Promise<void>) => {
      setBusy(true);
      setErrorMessage(null);
      try {
        await action();
      } catch (error) {
        // The commands name their own refusals: the role that may not activate,
        // the block that refused, the acknowledgment that did not match. Their
        // sentence beats anything this surface could guess.
        logRoundingQueryFailure(step, error, "");
        setErrorMessage(roundingCommandRefusal(error, fallback));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const propose = useCallback(
    () =>
      runCommand(
        "rounding.cadence_settings.create_version",
        "That proposal could not be saved. Retry, or try again in a moment.",
        async () => {
          const created = await createCadenceVersion(supabase, {
            facilityId,
            changeReason: proposalReason,
            windows: windowsChanged || configurationChanged ? windowDrafts : null,
            ...(configurationChanged ? { configuration: configurationDraft } : {}),
            rungs: rungsChanged ? rungDrafts : null,
          });
          const next: CadenceProposal = {
            cadenceVersionId: created.cadence_version_id,
            escalationVersionId: created.escalation_version_id,
          };
          setProposal(next);
          setSimulation(null);
          setNotice(null);
          await load(next);
        },
      ),
    [configurationChanged, configurationDraft, facilityId, load, proposalReason, rungDrafts, rungsChanged, runCommand, supabase, windowDrafts, windowsChanged],
  );

  const simulate = useCallback(
    () =>
      runCommand(
        "rounding.cadence_settings.simulate",
        "That simulation could not be run. Retry, or try again in a moment.",
        async () => {
          if (!proposal) return;
          setSimulation(
            await simulateCadenceChange(supabase, {
              facilityId,
              cadenceVersionId: proposal.cadenceVersionId,
              escalationVersionId: proposal.escalationVersionId,
            }),
          );
        },
      ),
    [facilityId, proposal, runCommand, supabase],
  );

  const commit = useCallback(
    () =>
      runCommand(
        "rounding.cadence_settings.activate",
        "That change could not be put in force. Retry, or try again in a moment.",
        async () => {
          if (!proposal) return;
          const answer = await activateCadenceVersion(supabase, {
            changeReason: activationReason,
            cadenceVersionId: proposal.cadenceVersionId,
            escalationVersionId: proposal.escalationVersionId,
            applyMode,
            effectiveFrom: applyMode === "scheduled" && scheduledFor ? new Date(scheduledFor).toISOString() : null,
            acknowledgment: acknowledgment.trim() === "" ? null : acknowledgment,
          });
          setNotice(
            answer.scheduled
              ? `Scheduled. It takes effect ${formatDisplayDateTime(answer.effective_from)}, and nothing on the board changes before then.`
              : "In force now. Pending checks past this moment were cancelled and will be rebuilt on the new schedule. Nothing completed, missed or already escalated was touched.",
          );
          resetDrafts();
          await load(null);
        },
      ),
    [acknowledgment, activationReason, applyMode, load, proposal, resetDrafts, runCommand, scheduledFor, supabase],
  );

  const rollback = useCallback(
    (entry: ChangeLogEntry) =>
      runCommand(
        "rounding.cadence_settings.rollback",
        "That version could not be copied forward. Retry, or try again in a moment.",
        async () => {
          await rollbackCadenceVersion(supabase, {
            facilityId,
            changeReason: `Going back to ${
              entry.kind === "cadence" ? "observation schedule" : "escalation ladder"
            } version ${entry.version_number}.`,
            restoreCadenceVersionId: entry.kind === "cadence" ? entry.version_id : null,
            restoreEscalationVersionId: entry.kind === "escalation" ? entry.version_id : null,
            applyMode: "next_shift_boundary",
            effectiveFrom: null,
            acknowledgment: overview?.facility_name ?? null,
          });
          setNotice("The older schedule was copied forward and scheduled for the next shift boundary.");
          resetDrafts();
          await load(null);
        },
      ),
    [facilityId, load, overview?.facility_name, resetDrafts, runCommand, supabase],
  );

  const testSend = useCallback(
    (rungKey: string) =>
      runCommand(
        "rounding.cadence_settings.test_send",
        "That test could not be sent. Retry, or try again in a moment.",
        async () => {
          setTestSendRungKey(rungKey);
          try {
            const answer = await sendTestEscalation(supabase, facilityId, rungKey);
            setNotice(
              `Test sent for ${answer.label} over ${answer.deliveries_queued} deliveries, with TEST as the first word. Nothing was recorded against a resident and no check was touched.`,
            );
          } finally {
            setTestSendRungKey(null);
          }
        },
      ),
    [facilityId, runCommand, supabase],
  );

  return {
    overview,
    changeLog,
    loadState,
    errorMessage,
    notice,
    configurationDraft,
    setConfigurationDraft,
    windowDrafts,
    setWindowDrafts,
    rungDrafts,
    setRungDrafts,
    proposalReason,
    setProposalReason,
    proposal,
    simulation,
    activationReason,
    setActivationReason,
    applyMode,
    setApplyMode,
    scheduledFor,
    setScheduledFor,
    acknowledgment,
    setAcknowledgment,
    busy,
    testSendRungKey,
    dirty: windowsChanged || rungsChanged || configurationChanged,
    reopenProposal: async (next: CadenceProposal) => { setProposal(next); setSimulation(null); setActivationReason(""); setAcknowledgment(""); await load(next); },
    reload: load,
    resetDrafts,
    propose,
    simulate,
    commit,
    rollback,
    testSend,
  };
}
