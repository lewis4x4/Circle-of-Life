import { describe, expect, it, vi } from "vitest";

import { createIdleTimer, heartbeatOutcome, idleLockMs, lockReasonForVisibility, type TimerApi } from "./lock-triggers";

function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const api: TimerApi = {
    setTimeout: (run, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, entry] of [...pending.entries()]) {
      if (entry.at <= now) {
        pending.delete(id);
        entry.run();
      }
    }
  };
  return { api, advance };
}

describe("idle lock", () => {
  it("uses the facility's idle minutes, bounded like the database (1 to 30)", () => {
    expect(idleLockMs(3)).toBe(180_000);
    expect(idleLockMs(0)).toBe(60_000);
    expect(idleLockMs(90)).toBe(1_800_000);
    expect(idleLockMs(Number.NaN)).toBe(180_000);
  });

  it("locks once after the idle window with no input", () => {
    const { api, advance } = fakeTimers();
    const onIdle = vi.fn();
    createIdleTimer({ idleMs: idleLockMs(3), onIdle, timers: api });
    advance(179_000);
    expect(onIdle).not.toHaveBeenCalled();
    advance(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    advance(600_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("starts the window again on every tap or key press", () => {
    const { api, advance } = fakeTimers();
    const onIdle = vi.fn();
    const timer = createIdleTimer({ idleMs: 180_000, onIdle, timers: api });
    advance(170_000);
    timer.reset();
    advance(170_000);
    timer.reset();
    advance(170_000);
    expect(onIdle).not.toHaveBeenCalled();
    advance(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does nothing after it is stopped", () => {
    const { api, advance } = fakeTimers();
    const onIdle = vi.fn();
    const timer = createIdleTimer({ idleMs: 1_000, onIdle, timers: api });
    timer.stop();
    timer.reset();
    advance(5_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe("screen dark", () => {
  it("locks when the page is hidden, as sleep", () => {
    expect(lockReasonForVisibility("hidden")).toBe("sleep");
    expect(lockReasonForVisibility("visible")).toBeNull();
  });
});

describe("heartbeat", () => {
  it("keeps an active unlock", () => {
    expect(heartbeatOutcome({ ok: true, status: 200, body: { active: true, reason: null } })).toEqual({ action: "keep" });
  });

  it("locks with the server's reason when the unlock is over", () => {
    expect(heartbeatOutcome({ ok: true, status: 200, body: { active: false, reason: "clocked_out" } })).toEqual({ action: "lock", reason: "clocked_out" });
    expect(heartbeatOutcome({ ok: true, status: 200, body: { active: false, reason: "max_age" } })).toEqual({ action: "lock", reason: "max_age" });
  });

  it("keeps working through a network failure or an unavailable database", () => {
    expect(heartbeatOutcome({ ok: false, status: 0, body: null })).toEqual({ action: "keep" });
    expect(heartbeatOutcome({ ok: false, status: 503, body: { error: "unavailable" } })).toEqual({ action: "keep" });
  });

  it("locks for good when the tablet itself is refused", () => {
    expect(heartbeatOutcome({ ok: false, status: 401, body: { error: "device_unknown" } })).toEqual({ action: "lock", reason: "device_revoked" });
  });
});
