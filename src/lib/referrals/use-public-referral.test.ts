import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePublicReferral } from "./use-public-referral";

const draft = { kind: "inquiry" as const, facility: "homewood" as const, name: "Test Family", phone: "3865550199", email: "test@example.invalid", message: "Please call." };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains the request key after uncertainty and edits, allowing conflict instead of a duplicate", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ ok: false, status: 409 });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => usePublicReferral());
  await act(async () => { expect(await result.current.submit(draft)).toBe(false); });
  await act(async () => { expect(await result.current.submit({ ...draft, message: "Edited after uncertain receipt." })).toBe(false); });
  expect(result.current.error).toContain("confirm receipt before sending a new request");
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const second = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(second.requestKey).toBe(first.requestKey);
  expect(second.message).not.toBe(first.message);
});

it("starts a fresh request identity only after confirmed durable success", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => usePublicReferral());
  await act(async () => { expect(await result.current.submit(draft)).toBe(true); });
  await act(async () => { expect(await result.current.submit(draft)).toBe(true); });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).requestKey).not.toBe(JSON.parse(fetchMock.mock.calls[1][1].body).requestKey);
});
