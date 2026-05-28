import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickCheckDrawer, type QuickCheckTask } from "./QuickCheckDrawer";

const task: QuickCheckTask = {
  id: "d1",
  residentName: "Jane Resident",
  roomLabel: "101A",
  dueAt: "2026-05-19T12:00:00.000Z",
  status: "due",
};

function renderDrawer(overrides: Partial<ComponentProps<typeof QuickCheckDrawer>> = {}) {
  const onClose = vi.fn();
  const onCompleted = vi.fn();

  render(
    <QuickCheckDrawer
      task={task}
      open
      onClose={onClose}
      onCompleted={onCompleted}
      {...overrides}
    />,
  );

  return { onClose, onCompleted };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("QuickCheckDrawer persistence mode", () => {
  it("persists synthetic-looking task ids by default", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { onCompleted } = renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rounding/tasks/d1/complete",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("d1"));
    expect(screen.getByText("Check complete")).toBeTruthy();
  });

  it("uses local-only completion only when explicitly configured as preview", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { onCompleted } = renderDrawer({ persistCompletion: false });

    expect(screen.getByText("Preview mode — checks are not saved to the database.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("d1"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Preview complete — not saved")).toBeTruthy();
  });
});
