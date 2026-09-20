import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/pwa/rounding-sync", () => ({ requestRoundingSyncState: mocks.request, flushQueuedRounds: mocks.request, subscribeToRoundingSyncState: () => () => {}, supportsRoundingOfflineSync: () => true }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } }) }));
import { useRoundingOfflineSync } from "./useRoundingOfflineSync";
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
it("hydrates consistently when Node exposes navigator without onLine", async () => {
  mocks.request.mockImplementation(() => new Promise(() => {}));
  function Probe() { const state = useRoundingOfflineSync(); return <span>{state.online ? "Synced" : "Offline"}</span>; }
  vi.stubGlobal("navigator", {});
  const html = renderToString(<Probe />);
  vi.stubGlobal("navigator", { onLine: true });
  const container = document.createElement("div"); document.body.append(container); container.innerHTML = html;
  const recoverable = vi.fn();
  await act(async () => { root = hydrateRoot(container, <Probe />, { onRecoverableError: recoverable }); });
  expect(recoverable).not.toHaveBeenCalled();
});

it("shows checking until the actual offline snapshot resolves after mount", async () => {
  mocks.request.mockResolvedValue({ online: false, supported: true, pendingCount: 0, queuedTaskIds: [], isSyncing: false, lastSyncedAt: null, lastError: null });
  function Probe() { const state = useRoundingOfflineSync(); return <span>{!state.ready ? "Checking sync" : state.online ? "Synced" : "Offline"}</span>; }
  vi.stubGlobal("navigator", {});
  const html = renderToString(<Probe />); expect(html).toContain("Checking sync");
  vi.stubGlobal("navigator", { onLine: false });
  const container = document.createElement("div"); document.body.append(container); container.innerHTML = html;
  const recoverable = vi.fn();
  await act(async () => { root = hydrateRoot(container, <Probe />, { onRecoverableError: recoverable }); });
  expect(recoverable).not.toHaveBeenCalled(); expect(container.textContent).toBe("Offline");
});
