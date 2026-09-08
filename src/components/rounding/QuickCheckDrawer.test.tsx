import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ rpc: vi.fn(), callback: null as null | ((event: string) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: auth.rpc,
  auth: { onAuthStateChange: (callback: (event: string) => void) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  } },
}) }));

import { QuickCheckDrawer, type QuickCheckTask } from "./QuickCheckDrawer";

const task: QuickCheckTask = {
  id: "d1",
  organizationId: "org",
  facilityId: "facility",
  residentName: "Jane Resident",
  roomLabel: "101A",
  dueAt: "2026-05-19T12:00:00.000Z",
  status: "due",
};

function renderDrawer(overrides: Partial<ComponentProps<typeof QuickCheckDrawer>> = {}) {
  const onClose = vi.fn();
  const onCompleted = vi.fn();

  const view = render(
    <QuickCheckDrawer
      task={task}
      open
      onClose={onClose}
      onCompleted={onCompleted}
      {...overrides}
    />,
  );

  return { ...view, onClose, onCompleted };
}

let sessionNumber = 0;
beforeEach(() => {
  auth.rpc.mockReset().mockResolvedValue({ data: { user_id: "operator", session_id: `session-${++sessionNumber}`, organization_id: "org" }, error: null });
  auth.callback = null;
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

    fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));

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

    fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));

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
    fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));
    await screen.findByText("Failed to fetch");
    expect(onCompleted).not.toHaveBeenCalled();
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(first.observedAt))).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));
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
  fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));
  fireEvent.change(await screen.findByLabelText("Reason for delayed entry"), { target: { value: "Connection interrupted during the original entry" } });
  fireEvent.click(await screen.findByRole("button", { name: /complete check|retry original check/i }));
  await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const second = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(second).toEqual({ ...first, lateReason: "Connection interrupted during the original entry" });
});

describe("pending clinical observation lifecycle", () => {
  const props = { task, open: true, onClose: vi.fn(), onCompleted: vi.fn() };
  async function enterDistress() {
    fireEvent.click(await screen.findByRole("radio", { name: /distressed/i }));
    fireEvent.change(screen.getByPlaceholderText("Describe the situation..."), { target: { value: "Synthetic original clinical note" } });
    fireEvent.click(screen.getByRole("switch", { name: "Hydration offered" }));
    fireEvent.click(screen.getByRole("button", { name: "common area" }));
    fireEvent.click(screen.getByRole("button", { name: "in chair" }));
    fireEvent.click(screen.getByRole("button", { name: "Appears ill" }));
    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
  }
  function request(fetchMock: ReturnType<typeof vi.fn>, index: number) {
    return JSON.parse(fetchMock.mock.calls[index][1].body as string);
  }

  it.each([false, true])("replays complete original details across close, task switch and remount (first attempt committed: %s)", async (committed) => {
    let receipt: unknown;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string);
      if (fetchMock.mock.calls.length === 1) {
        if (committed) receipt = payload;
        throw new TypeError("Response lost");
      }
      if (receipt && JSON.stringify(receipt) !== JSON.stringify(payload)) {
        return new Response(JSON.stringify({ error: "Receipt conflict" }), { status: 409 });
      }
      receipt = payload;
      return new Response(JSON.stringify({ ok: true, replayed: committed }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<QuickCheckDrawer {...props} />);
    await enterDistress();
    await screen.findByText("Response lost");
    const original = request(fetchMock, 0);
    expect(original).toMatchObject({ quickStatus: "distressed", distressPresent: true, note: "Synthetic original clinical note", hydrationOffered: true, residentLocation: "common area", residentPosition: "in chair", exceptionType: "resident_appears_ill" });
    view.rerender(<QuickCheckDrawer {...props} open={false} />);
    view.rerender(<QuickCheckDrawer {...props} task={{ ...task, id: "another-task" }} />);
    await screen.findByRole("button", { name: /complete check/i });
    expect(screen.queryByDisplayValue("Synthetic original clinical note")).toBeNull();
    view.unmount();
    render(<QuickCheckDrawer {...props} task={{ ...task }} />);
    await screen.findByDisplayValue("Synthetic original clinical note");
    expect(screen.getByRole("radio", { name: /distressed/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /distressed/i }).closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /retry original check/i }));
    await screen.findByText("Check complete");
    expect(request(fetchMock, 1)).toEqual(original);
    expect(receipt).toEqual(original);
  });

  it("retains separate pending requests when both tasks lose responses", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Response lost"));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<QuickCheckDrawer {...props} />);
    await enterDistress();
    await screen.findByText("Response lost");
    const first = request(fetchMock, 0);
    view.rerender(<QuickCheckDrawer {...props} task={{ ...task, id: "second-task" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /complete check/i }));
    await screen.findByText("Response lost");
    const second = request(fetchMock, 1);
    expect(second.requestId).not.toBe(first.requestId);
    view.rerender(<QuickCheckDrawer {...props} task={{ ...task }} />);
    fireEvent.click(await screen.findByRole("button", { name: /retry original check/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(request(fetchMock, 2)).toEqual(first);
  });

  it("keeps ambiguous payload frozen across the five-minute boundary, amending only a rejected unsaved reason", async () => {
    const startedAt = Date.now();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Reason required; request unsaved", reasonRequired: true }), { status: 400 }))
      .mockRejectedValueOnce(new TypeError("Reason response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<QuickCheckDrawer {...props} />);
    await enterDistress();
    await screen.findByText("Response lost");
    const original = request(fetchMock, 0);
    vi.spyOn(Date, "now").mockReturnValue(startedAt + 6 * 60_000);
    view.rerender(<QuickCheckDrawer {...props} open={false} />);
    view.rerender(<QuickCheckDrawer {...props} />);
    await screen.findByDisplayValue("Synthetic original clinical note");
    expect(screen.queryByLabelText("Reason for delayed entry")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry original check/i }));
    const reason = await screen.findByLabelText("Reason for delayed entry");
    expect(request(fetchMock, 1)).toEqual(original);
    fireEvent.change(reason, { target: { value: "Connection interrupted during original entry" } });
    fireEvent.click(screen.getByRole("button", { name: /retry original check/i }));
    await screen.findByText("Reason response lost");
    expect(screen.queryByLabelText("Reason for delayed entry")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry original check/i }));
    await screen.findByText("Check complete");
    expect(request(fetchMock, 2)).toEqual({ ...original, lateReason: "Connection interrupted during original entry" });
    expect(request(fetchMock, 3)).toEqual(request(fetchMock, 2));
    vi.restoreAllMocks();
  });

  it.each(["operator", "session", "organization", "facility"])("does not expose or replay another %s scope's pending payload", async (changed) => {
    const originalActor = { user_id: "operator", session_id: `session-${sessionNumber}`, organization_id: "org" };
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Response lost"));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<QuickCheckDrawer {...props} />);
    await enterDistress();
    await screen.findByText("Response lost");
    const original = request(fetchMock, 0);
    const otherActor = { ...originalActor,
      ...(changed === "operator" ? { user_id: "other-operator" } : {}),
      ...(changed === "session" ? { session_id: "other-session" } : {}),
      ...(changed === "organization" ? { organization_id: "other-org" } : {}),
    };
    auth.rpc.mockResolvedValue({ data: otherActor, error: null });
    const otherTask = { ...task,
      ...(changed === "organization" ? { organizationId: "other-org" } : {}),
      ...(changed === "facility" ? { facilityId: "other-facility" } : {}),
    };
    await act(async () => auth.callback?.("SIGNED_IN"));
    view.rerender(<QuickCheckDrawer {...props} task={otherTask} />);
    await screen.findByRole("button", { name: /complete check/i });
    expect(screen.queryByDisplayValue("Synthetic original clinical note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
    await screen.findByText("Response lost");
    expect(request(fetchMock, 1).requestId).not.toBe(original.requestId);
    expect(request(fetchMock, 1).note).toBeNull();
    auth.rpc.mockResolvedValue({ data: originalActor, error: null });
    await act(async () => auth.callback?.("SIGNED_IN"));
    view.rerender(<QuickCheckDrawer {...props} />);
    await screen.findByDisplayValue("Synthetic original clinical note");
    fireEvent.click(screen.getByRole("button", { name: /retry original check/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(request(fetchMock, 2)).toEqual(original);
  });

  it("refuses dispatch when the session changes during preflight without an auth event", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickCheckDrawer {...props} />);
    await screen.findByRole("button", { name: /complete check/i });
    auth.rpc.mockResolvedValue({ data: { user_id: "operator", session_id: "changed-session", organization_id: "org" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: /complete check/i }));
    await screen.findByText(/account or session changed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("settles an old task's in-flight request without completing the task opened afterward", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const onCompleted = vi.fn();
    const view = render(<QuickCheckDrawer {...props} onCompleted={onCompleted} />);
    await enterDistress();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    view.rerender(<QuickCheckDrawer {...props} task={{ ...task, id: "second-task" }} onCompleted={onCompleted} />);
    await screen.findByRole("button", { name: /complete check/i });
    await act(async () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(screen.queryByText("Check complete")).toBeNull();
  });
});

it("consumes an acknowledgment received after close and reopen without offering a new observation", async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  const props = { task, open: true, onClose: vi.fn(), onCompleted: vi.fn() };
  const view = render(<QuickCheckDrawer {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /complete check/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  view.rerender(<QuickCheckDrawer {...props} open={false} />);
  view.rerender(<QuickCheckDrawer {...props} />);
  await screen.findByRole("button", { name: /saving/i });
  await act(async () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  await screen.findByText("Check complete");
  expect(props.onCompleted).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(screen.queryByRole("button", { name: /complete check/i })).toBeNull();
  view.rerender(<QuickCheckDrawer {...props} open={false} />);
  view.rerender(<QuickCheckDrawer {...props} />);
  await screen.findByText("Check complete");
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("cancels sequential advancement when the completed drawer is replaced", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  const onNextTask = vi.fn();
  const props = { task, open: true, onClose: vi.fn(), onCompleted: vi.fn(), onNextTask, queuePosition: { current: 1, total: 2 } };
  const view = render(<QuickCheckDrawer {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /complete check/i }));
  await screen.findByText("Check complete");
  view.rerender(<QuickCheckDrawer {...props} task={{ ...task, id: "next-task" }} />);
  await screen.findByRole("button", { name: /complete check/i });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)); });
  expect(onNextTask).not.toHaveBeenCalled();
});


it.each([2, 3])("advances to B when completing A removes it from a %s-resident parent queue", async (count) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  const advanced = vi.fn();
  function ParentQueue() {
    const [queue, setQueue] = useState(["A", "B", "C"].slice(0, count));
    return <QuickCheckDrawer task={task} open onClose={vi.fn()}
      onCompleted={() => setQueue((previous) => previous.filter((id) => id !== "A"))}
      queuePosition={{ current: 1, total: queue.length }}
      onNextTask={() => advanced(queue[1])} />;
  }
  render(<ParentQueue />);
  fireEvent.click(await screen.findByRole("button", { name: /complete check/i }));
  await screen.findByText("Check complete");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)); });
  expect(advanced).toHaveBeenCalledExactlyOnceWith("B");
});
