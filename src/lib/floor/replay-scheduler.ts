/**
 * While someone is unlocked, items other people left on this tablet keep
 * going out as their owners (spec 40 §1 "Offline"): the device replay runs at
 * unlock, again whenever the network comes back, and on an interval, so one
 * failed pass never leaves them waiting until the next lock. One pass at a
 * time; stopped on lock.
 */

export const FLOOR_REPLAY_RETRY_MS = 60_000;

type Target = Pick<Window, "addEventListener" | "removeEventListener">;
type Timers = { setInterval: (run: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void };

const browserTimers: Timers = {
  setInterval: (run, ms) => globalThis.setInterval(run, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export type ReplayScheduler = { stop(): void; runNow(): Promise<void> };

export function startFloorReplayScheduler(input: {
  run: () => Promise<unknown>;
  /** After each pass, successful or not: refresh what the top bar shows. */
  onSettled?: () => void;
  intervalMs?: number;
  target?: Target;
  timers?: Timers;
}): ReplayScheduler {
  const timers = input.timers ?? browserTimers;
  const target = input.target ?? (typeof window !== "undefined" ? window : undefined);
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = input
      .run()
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        inFlight = null;
        if (!stopped) input.onSettled?.();
      });
    return inFlight;
  };

  const onOnline = () => void runNow();
  target?.addEventListener("online", onOnline);
  const handle = timers.setInterval(() => void runNow(), input.intervalMs ?? FLOOR_REPLAY_RETRY_MS);
  void runNow();

  return {
    stop() {
      stopped = true;
      target?.removeEventListener("online", onOnline);
      timers.clearInterval(handle);
    },
    runNow,
  };
}
