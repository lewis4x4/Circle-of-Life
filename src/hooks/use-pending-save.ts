"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  PendingSaveMachine,
  createFetchAdapters,
  listPendingDrafts,
  type AdapterAnswer,
  type DraftSummary,
  type SaveAdapters,
  type SaveDraftInput,
  type SaveState,
} from "@/lib/operations/recovery-client";

/**
 * COL-146 pending-save state for one recording surface on a shared device.
 * The machine lives in memory and is keyed by the current actor id: when the
 * actor changes or signs out (the auth context yields a null user after
 * `supabase.auth.signOut()`), the machine is reset, answers still in flight
 * are ignored and nothing of the previous person remains. On mount, and on
 * every actor change, the actor's own pending drafts are listed from the
 * server so an earlier unsaved save can be checked, resumed or discarded.
 * The caller passes the actor id from `useHavenAuth().user?.id`.
 */

export type UsePendingSaveOptions = {
  actorId: string | null | undefined;
  /** Injected in tests; defaults to the fetch adapters over the drafts routes. */
  adapters?: SaveAdapters;
  listPending?: () => Promise<AdapterAnswer<{ drafts: DraftSummary[] }>>;
};

export type PendingSave = {
  actorId: string | null;
  state: SaveState;
  /** The actor's own pending drafts from the server, newest first, not yet adopted. */
  pendingDrafts: DraftSummary[];
  listing: boolean;
  save: (input: SaveDraftInput) => Promise<SaveState>;
  retry: () => Promise<SaveState>;
  discard: () => Promise<SaveState>;
  checkAgain: () => Promise<SaveState>;
  adopt: (draft: DraftSummary) => Promise<SaveState>;
  reset: () => void;
};

const IDLE: SaveState = { kind: "idle" };

export function usePendingSave({ actorId, adapters, listPending }: UsePendingSaveOptions): PendingSave {
  const machineRef = useRef<{ actorId: string; machine: PendingSaveMachine } | null>(null);
  const adaptersRef = useRef(adapters);
  const listRef = useRef(listPending);
  const [state, setState] = useState<SaveState>(IDLE);
  const [pendingDrafts, setPendingDrafts] = useState<DraftSummary[]>([]);
  /** The actor whose drafts were last listed; listing is in progress until it matches the current actor. */
  const [listedFor, setListedFor] = useState<string | null>(null);
  const currentActorId = actorId ?? null;
  const listing = currentActorId !== null && listedFor !== currentActorId;

  // Adapter identity never rebuilds the machine; effects run in order, so the machine effect below reads the latest ones.
  useEffect(() => {
    adaptersRef.current = adapters;
    listRef.current = listPending;
  }, [adapters, listPending]);

  useEffect(() => {
    if (!currentActorId) return;
    const machine = new PendingSaveMachine(adaptersRef.current ?? createFetchAdapters());
    machineRef.current = { actorId: currentActorId, machine };
    const unsubscribe = machine.subscribe(setState);
    let cancelled = false;
    void (listRef.current ?? listPendingDrafts)().then((answer) => {
      if (cancelled) return;
      setPendingDrafts(answer.kind === "ok" ? answer.body.drafts.filter((draft) => draft.state === "pending") : []);
      setListedFor(currentActorId);
    });
    return () => {
      // The actor changed, signed out or the surface unmounted: drop everything of this person.
      cancelled = true;
      unsubscribe();
      machine.reset();
      machineRef.current = null;
      setState(IDLE);
      setPendingDrafts([]);
      // Forget who was listed so the same person signing in again is listed afresh.
      setListedFor(null);
    };
  }, [currentActorId]);

  const withMachine = useCallback(
    (run: (machine: PendingSaveMachine) => Promise<SaveState>): Promise<SaveState> => {
      const held = machineRef.current;
      if (!held || held.actorId !== currentActorId) return Promise.resolve(IDLE);
      return run(held.machine);
    },
    [currentActorId],
  );

  const save = useCallback((input: SaveDraftInput) => withMachine((machine) => machine.save(input)), [withMachine]);
  const retry = useCallback(() => withMachine((machine) => machine.retry()), [withMachine]);
  const discard = useCallback(() => withMachine((machine) => machine.discard()), [withMachine]);
  const checkAgain = useCallback(() => withMachine((machine) => machine.reconcile()), [withMachine]);
  const adopt = useCallback(
    (draft: DraftSummary) => {
      setPendingDrafts((drafts) => drafts.filter((candidate) => candidate.id !== draft.id));
      return withMachine((machine) => machine.adopt(draft));
    },
    [withMachine],
  );
  const reset = useCallback(() => {
    machineRef.current?.machine.reset();
  }, []);

  return { actorId: currentActorId, state, pendingDrafts, listing, save, retry, discard, checkAgain, adopt, reset };
}
