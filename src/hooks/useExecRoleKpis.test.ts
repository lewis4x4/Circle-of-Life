import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useExecRoleKpis } from "./useExecRoleKpis";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const fetchExecutiveKpiSnapshotMock = vi.hoisted(() => vi.fn());
const fetchExecutiveAlertsMock = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({
        on: () => ({
          on: () => ({
            subscribe: () => ({
              unsubscribe: () => Promise.resolve(),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/exec-kpi-snapshot", () => ({
  fetchExecutiveKpiSnapshot: fetchExecutiveKpiSnapshotMock,
}));

vi.mock("@/lib/exec-alerts", () => ({
  fetchExecutiveAlerts: fetchExecutiveAlertsMock,
}));

describe("useExecRoleKpis auth hydration", () => {
  beforeEach(() => {
    fetchExecutiveKpiSnapshotMock.mockReset();
    fetchExecutiveAlertsMock.mockReset();
    fetchExecutiveKpiSnapshotMock.mockResolvedValue({
      census: { occupancyPct: 0 },
      financial: { totalBalanceDueCents: 0, openInvoicesCount: 0 },
      workforce: { certificationsExpiring30d: 0 },
    });
    fetchExecutiveAlertsMock.mockResolvedValue([]);
  });

  it("does not surface the legacy org crash string while auth hydrates", async () => {
    authMock.loading = true;
    authMock.organizationId = null;

    const { result } = renderHook(() => useExecRoleKpis(null));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(fetchExecutiveKpiSnapshotMock).not.toHaveBeenCalled();
    });
  });

  it("leaves error null when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    const { result } = renderHook(() => useExecRoleKpis(null));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(fetchExecutiveKpiSnapshotMock).not.toHaveBeenCalled();
  });

  it("surfaces real fetch failures after auth resolves with an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchExecutiveKpiSnapshotMock.mockRejectedValue(new Error("Unable to reach KPI snapshot."));

    const { result } = renderHook(() => useExecRoleKpis(null));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Unable to reach KPI snapshot.");
  });
});
