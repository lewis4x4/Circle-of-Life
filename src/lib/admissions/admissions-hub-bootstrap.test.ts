import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/test-utils/fake-supabase";

import { loadAdmissionsHubBootstrap } from "./admissions-hub-bootstrap";

const FACILITY = "00000000-0000-4000-8000-000000000001";

describe("loadAdmissionsHubBootstrap metrics (COL-649)", () => {
  it("fails instead of showing 0 when a metric count comes back missing", async () => {
    const { client } = fakeSupabase((call) =>
      call.head ? { count: call.table === "admission_cases" ? null : 2 } : { data: [] },
    );
    await expect(loadAdmissionsHubBootstrap(FACILITY, "all", client)).rejects.toThrow(/count unavailable/);
  });

  it("returns the real counts", async () => {
    const { client } = fakeSupabase((call) => (call.head ? { count: 3 } : { data: [] }));
    const hub = await loadAdmissionsHubBootstrap(FACILITY, "all", client);
    expect(hub.referralMetrics.activePipeline).toBe(3);
    expect(hub.familyMetrics.consentsPending).toBe(3);
  });
});
