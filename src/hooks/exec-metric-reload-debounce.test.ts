import { afterEach, describe, expect, it, vi } from "vitest";

import { createReloadDebouncer } from "@/hooks/exec-metric-reload-debounce";

describe("createReloadDebouncer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces burst triggers into one reload", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(async () => undefined);
    const debouncer = createReloadDebouncer(reload, 200);

    debouncer.trigger();
    debouncer.trigger();
    debouncer.trigger();

    vi.advanceTimersByTime(199);
    expect(reload).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("cancels pending reload", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(async () => undefined);
    const debouncer = createReloadDebouncer(reload, 200);

    debouncer.trigger();
    debouncer.cancel();

    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(0);
  });
});
