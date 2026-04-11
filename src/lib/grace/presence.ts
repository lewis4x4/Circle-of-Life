"use client";

import { useSyncExternalStore } from "react";
import type { GraceAvatarState } from "./types";

const PRIORITY: Record<GraceAvatarState, number> = {
  alert: 10,
  listening: 8,
  speaking: 7,
  thinking: 6,
  flow_active: 5,
  success: 3,
  idle: 0,
};

interface PresenceEntry {
  id: number;
  source: string;
  state: GraceAvatarState;
  pushedAt: number;
  expiresAt?: number;
}

type Listener = () => void;

let entries: PresenceEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function recomputeWinning(): GraceAvatarState {
  const now = Date.now();
  if (entries.some((entry) => entry.expiresAt !== undefined && entry.expiresAt <= now)) {
    entries = entries.filter((entry) => entry.expiresAt === undefined || entry.expiresAt > now);
  }
  if (entries.length === 0) return "idle";

  let winner: PresenceEntry | null = null;
  for (const entry of entries) {
    if (
      !winner ||
      PRIORITY[entry.state] > PRIORITY[winner.state] ||
      (PRIORITY[entry.state] === PRIORITY[winner.state] && entry.pushedAt > winner.pushedAt)
    ) {
      winner = entry;
    }
  }
  return winner?.state ?? "idle";
}

function emit(): void {
  recomputeWinning();
  for (const listener of listeners) listener();
}

export function pushGracePresence(
  source: string,
  state: GraceAvatarState,
  opts?: { ttlMs?: number },
): () => void {
  const id = nextId++;
  const now = Date.now();
  entries.push({
    id,
    source,
    state,
    pushedAt: now,
    expiresAt: opts?.ttlMs !== undefined ? now + opts.ttlMs : undefined,
  });
  emit();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const before = entries.length;
    entries = entries.filter((entry) => entry.id !== id);
    if (before !== entries.length) emit();
  };

  if (opts?.ttlMs !== undefined) {
    setTimeout(release, opts.ttlMs);
  }

  return release;
}

export function replaceGracePresence(
  source: string,
  state: GraceAvatarState,
  opts?: { ttlMs?: number },
): () => void {
  entries = entries.filter((entry) => entry.source !== source);
  return pushGracePresence(source, state, opts);
}

export function clearGracePresenceSource(source: string): void {
  const before = entries.length;
  entries = entries.filter((entry) => entry.source !== source);
  if (before !== entries.length) emit();
}

export function getCurrentGracePresenceState(): GraceAvatarState {
  return recomputeWinning();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGracePresenceState(): GraceAvatarState {
  return useSyncExternalStore(subscribe, getCurrentGracePresenceState, getCurrentGracePresenceState);
}

export function __resetGracePresenceForTests(): void {
  entries = [];
  nextId = 1;
  emit();
}
