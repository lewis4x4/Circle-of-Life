import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDashboardPreferences } from "./preferences";

function createPreferencesFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    if (method === "PUT") {
      return new Response(
        JSON.stringify({
          dashboardId: "dashboard-1",
          columnOrder: [],
          columnVisibility: { colA: false },
          savedViews: [],
          exists: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        dashboardId: "dashboard-1",
        columnOrder: [],
        columnVisibility: {},
        savedViews: [],
        exists: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch & { mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } };
}

function Harness({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const { loading, setColumnVisibility } = useDashboardPreferences("dashboard-1", {
    endpoint: "/api/v2/preferences",
    fetchImpl,
    debounceMs: 10,
  });

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => setColumnVisibility({ colA: false })}
    >
      toggle
    </button>
  );
}

function requestMethods(fetchImpl: ReturnType<typeof createPreferencesFetch>) {
  return fetchImpl.mock.calls.map(([, init]) => init?.method ?? "GET");
}

describe("useDashboardPreferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not issue a second initial GET after state-driven rerender with default fetch", async () => {
    const fetchImpl = createPreferencesFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const { unmount } = render(<Harness />);

    const toggleButton = screen.getByRole("button", { name: "toggle" });
    await waitFor(() => expect(toggleButton).toBeEnabled());

    fireEvent.click(toggleButton);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      const methods = requestMethods(fetchImpl);
      expect(methods.filter((method) => method === "GET")).toHaveLength(1);
      expect(methods.filter((method) => method === "PUT")).toHaveLength(1);
    });

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    const methods = requestMethods(fetchImpl);
    expect(methods.filter((method) => method === "GET")).toHaveLength(1);
    expect(methods.filter((method) => method === "PUT")).toHaveLength(1);
  });

  it("continues to use an injected fetch implementation when provided", async () => {
    const globalFetch = createPreferencesFetch();
    const injectedFetch = createPreferencesFetch();
    vi.stubGlobal("fetch", globalFetch);

    render(<Harness fetchImpl={injectedFetch} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "toggle" })).toBeEnabled());

    expect(requestMethods(injectedFetch)).toEqual(["GET"]);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
