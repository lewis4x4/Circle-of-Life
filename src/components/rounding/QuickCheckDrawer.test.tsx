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

describe("completion retry identity", () => {
  it("reuses the original request and observation time after a lost response", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { onCompleted } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
    await screen.findByText("Failed to fetch");
    expect(onCompleted).not.toHaveBeenCalled();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(first.observedAt))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retry).toEqual(first);
  });
});

it("allows a delayed unsaved request to gain its required reason without changing identity", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Add a reason for this delayed entry, then retry.", reasonRequired: true }), { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { onCompleted } = renderDrawer();
  fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
  fireEvent.change(await screen.findByLabelText("Reason for delayed entry"), { target: { value: "Connection interrupted during the original entry" } });
  fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
  await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const second = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(second).toEqual({ ...first, lateReason: "Connection interrupted during the original entry" });
});
