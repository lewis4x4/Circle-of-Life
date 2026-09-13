import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdapterAnswer, DraftSummary, SaveAdapters, SaveDraftInput } from "@/lib/operations/recovery-client";
import { usePendingSave } from "./use-pending-save";

const occurrenceId = "55555555-5555-4555-8555-555555555555";
const receiptId = "77777777-7777-4777-8777-777777777777";
const draftId = "99999999-9999-4999-8999-999999999999";
const key = "record:2026-09-10:0001";
const input: SaveDraftInput = { request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed" } } };
const draft: DraftSummary = { id: draftId, command: "record_work", target_id: occurrenceId, request_key: key, state: "pending", expires_at: null };
const receiptReply = { outcome: "receipt", receipt: { id: receiptId }, occurrence: { id: occurrenceId }, issue: null, replayed: false };
const ok = <T,>(body: T): AdapterAnswer<T> => ({ kind: "ok", body });

function adapters(overrides: Partial<SaveAdapters> = {}): SaveAdapters {
  return {
    saveDraft: vi.fn(async () => ok({ draft, replayed: false })),
    execute: vi.fn(async () => ok(receiptReply)),
    reconcile: vi.fn(async () => ok({ outcome: "unsaved" as const, draft })),
    resume: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...draft, state: "reconciled" }, reply: receiptReply })),
    discard: vi.fn(async () => ok({ outcome: "discarded" as const, draft: { ...draft, state: "discarded" } })),
    ...overrides,
  };
}

describe("usePendingSave", () => {
  it("lists the actor's own pending drafts on mount and lets one be adopted for reconciliation", async () => {
    const io = adapters();
    const listPending = vi.fn(async () => ok({ drafts: [draft, { ...draft, id: "expired-one", state: "expired" }] }));
    const { result } = renderHook(() => usePendingSave({ actorId: "person-a", adapters: io, listPending }));
    expect(result.current.listing).toBe(true);
    await waitFor(() => expect(result.current.pendingDrafts).toEqual([draft]));
    expect(listPending).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("idle");
    await act(async () => {
      await result.current.adopt(draft);
    });
    expect(result.current.pendingDrafts).toEqual([]);
    expect(result.current.state.kind).toBe("unsaved");
    expect(io.reconcile).toHaveBeenCalledExactlyOnceWith(draftId);
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state.kind).toBe("saved");
  });

  it("does nothing without an actor and starts listing once one signs in", async () => {
    const listPending = vi.fn(async () => ok({ drafts: [draft] }));
    const { result, rerender } = renderHook(({ actorId }: { actorId: string | null }) => usePendingSave({ actorId, adapters: adapters(), listPending }), { initialProps: { actorId: null } });
    expect(listPending).not.toHaveBeenCalled();
    expect(result.current.listing).toBe(false);
    expect((await result.current.save(input)).kind).toBe("idle");
    rerender({ actorId: "person-a" });
    await waitFor(() => expect(result.current.pendingDrafts).toEqual([draft]));
  });

  it("drops the state and the listed drafts when the actor changes and relists for the new person", async () => {
    const io = adapters({ execute: vi.fn(async () => ({ kind: "lost", reason: "network" })) });
    const listPending = vi.fn(async () => ok({ drafts: [draft] }));
    const { result, rerender } = renderHook(({ actorId }: { actorId: string | null }) => usePendingSave({ actorId, adapters: io, listPending }), { initialProps: { actorId: "person-a" as string | null } });
    await waitFor(() => expect(result.current.pendingDrafts).toHaveLength(1));
    await act(async () => {
      await result.current.save(input);
    });
    expect(result.current.state.kind).toBe("unsaved");
    listPending.mockResolvedValueOnce(ok({ drafts: [] }));
    rerender({ actorId: "person-b" });
    expect(result.current.state).toEqual({ kind: "idle" });
    expect(result.current.actorId).toBe("person-b");
    await waitFor(() => expect(listPending).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.pendingDrafts).toEqual([]);
    // The previous person's draft cannot be retried by the new person from this device.
    expect((await result.current.retry()).kind).toBe("idle");
    expect(io.resume).not.toHaveBeenCalled();
  });

  it("drops everything on sign-out and ignores the old person's answer when it lands", async () => {
    let release!: (value: AdapterAnswer<Record<string, unknown>>) => void;
    const io = adapters({ execute: vi.fn(() => new Promise<AdapterAnswer<Record<string, unknown>>>((resolve) => { release = resolve; })) });
    const listPending = vi.fn(async () => ok({ drafts: [] }));
    const { result, rerender } = renderHook(({ actorId }: { actorId: string | null }) => usePendingSave({ actorId, adapters: io, listPending }), { initialProps: { actorId: "person-a" as string | null } });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.save(input);
    });
    await waitFor(() => expect(result.current.state.kind).toBe("submitting"));
    rerender({ actorId: null });
    expect(result.current.state).toEqual({ kind: "idle" });
    expect(result.current.actorId).toBeNull();
    await act(async () => {
      release(ok(receiptReply));
      await pending;
    });
    expect(result.current.state).toEqual({ kind: "idle" });
    expect(io.reconcile).not.toHaveBeenCalled();
  });

  it("lists afresh when the same person signs out and back in", async () => {
    const listPending = vi.fn(async () => ok({ drafts: [draft] }));
    const { result, rerender } = renderHook(({ actorId }: { actorId: string | null }) => usePendingSave({ actorId, adapters: adapters(), listPending }), { initialProps: { actorId: "person-a" as string | null } });
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.pendingDrafts).toEqual([draft]);
    rerender({ actorId: null });
    expect(result.current.pendingDrafts).toEqual([]);
    expect(result.current.listing).toBe(false);
    rerender({ actorId: "person-a" });
    expect(result.current.listing).toBe(true);
    await waitFor(() => expect(listPending).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.pendingDrafts).toEqual([draft]);
  });

  it("ignores a listing that lands after the actor changed", async () => {
    let releaseList!: (value: AdapterAnswer<{ drafts: DraftSummary[] }>) => void;
    const listPending = vi.fn(() => new Promise<AdapterAnswer<{ drafts: DraftSummary[] }>>((resolve) => { releaseList = resolve; }));
    const { result, rerender } = renderHook(({ actorId }: { actorId: string | null }) => usePendingSave({ actorId, adapters: adapters(), listPending }), { initialProps: { actorId: "person-a" as string | null } });
    const releaseFirst = releaseList;
    rerender({ actorId: null });
    await act(async () => {
      releaseFirst(ok({ drafts: [draft] }));
    });
    expect(result.current.pendingDrafts).toEqual([]);
    expect(result.current.listing).toBe(false);
  });
});
