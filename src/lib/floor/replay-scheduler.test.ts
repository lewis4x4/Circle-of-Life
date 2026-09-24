import { describe, expect, it, vi } from "vitest";

import { startFloorReplayScheduler } from "./replay-scheduler";

function harness() {
  const listeners = new Set<() => void>();
  let tick: (() => void) | null = null;
  return {
    target: {
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
    timers: {
      setInterval: (run: () => void) => {
        tick = run;
        return 1;
      },
      clearInterval: () => {
        tick = null;
      },
    },
    online: () => [...listeners].forEach((fn) => fn()),
    tick: () => tick?.(),
    listenerCount: () => listeners.size,
    hasTimer: () => tick !== null,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("floor device replay while someone is signed in", () => {
  it("runs at unlock, then again on the interval and when the network returns", async () => {
    const h = harness();
    const run = vi.fn(() => Promise.resolve());
    const onSettled = vi.fn();
    startFloorReplayScheduler({ run, onSettled, target: h.target, timers: h.timers });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    h.tick();
    await flush();
    h.online();
    await flush();
    expect(run).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(3);
  });

  it("retries after a failed pass instead of waiting for the next lock", async () => {
    const h = harness();
    const run = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(undefined);
    startFloorReplayScheduler({ run, target: h.target, timers: h.timers });
    await flush();
    h.online();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never runs two passes at once", async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    startFloorReplayScheduler({ run, target: h.target, timers: h.timers });
    h.tick();
    h.online();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    h.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops on lock: no listener, no timer, no more passes", async () => {
    const h = harness();
    const run = vi.fn(() => Promise.resolve());
    const scheduler = startFloorReplayScheduler({ run, target: h.target, timers: h.timers });
    await flush();
    scheduler.stop();
    h.online();
    h.tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.listenerCount()).toBe(0);
    expect(h.hasTimer()).toBe(false);
  });
});
