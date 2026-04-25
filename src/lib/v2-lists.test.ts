import { afterEach, describe, expect, it, vi } from "vitest";

let mockResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: null,
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } }, error: null })),
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve(mockResult),
        }),
      }),
    }),
  })),
}));

import { V2_LIST_IDS, isV2ListId, loadV2List } from "./v2-lists";

describe("v2-lists narrowing + loader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockResult = { data: null, error: null };
  });

  it("exposes the four canonical list ids", () => {
    expect(V2_LIST_IDS).toEqual(["residents", "incidents", "alerts", "admissions"]);
  });

  it("isV2ListId narrows correctly", () => {
    expect(isV2ListId("residents")).toBe(true);
    expect(isV2ListId("alerts")).toBe(true);
    expect(isV2ListId("nope")).toBe(false);
    expect(isV2ListId("")).toBe(false);
  });

  it("falls back to the fixture set when the view returns no rows", async () => {
    mockResult = { data: [], error: null };
    const load = await loadV2List("residents");
    expect(load.source).toBe("fixture");
    expect(load.rows.length).toBeGreaterThan(0);
  });

  it("falls back to the fixture set when the view errors", async () => {
    mockResult = { data: null, error: { message: "boom" } };
    const load = await loadV2List("incidents");
    expect(load.source).toBe("fixture");
  });

  it("maps live residents view rows into the canonical V2ListRow shape", async () => {
    mockResult = {
      data: [
        {
          resident_id: "r-1",
          facility_id: "f-1",
          facility_name: "Oakridge ALF",
          resident_name: "A. Smith",
          resident_status: "active",
          primary_diagnosis: "Heart failure",
        },
      ],
      error: null,
    };
    const load = await loadV2List("residents");
    expect(load.source).toBe("live");
    expect(load.rows[0]).toMatchObject({
      id: "r-1",
      primary: "A. Smith",
      facilityName: "Oakridge ALF",
      status: "active",
      secondary: "Heart failure",
    });
  });

  it("maps live incidents view rows including badges and severity", async () => {
    mockResult = {
      data: [
        {
          incident_id: "i-1",
          facility_id: "f-1",
          facility_name: "Oakridge ALF",
          incident_number: "INC-001",
          category: "fall",
          severity: "high",
          incident_status: "open",
          occurred_at: "2026-04-24T12:00:00-04:00",
          injury_occurred: true,
          ahca_reportable: true,
          ahca_reported: false,
        },
      ],
      error: null,
    };
    const load = await loadV2List("incidents");
    expect(load.rows[0]!.severity).toBe("high");
    expect(load.rows[0]!.badges).toEqual(["Injury", "AHCA reportable"]);
  });

  it("maps live alerts view rows with severity normalization", async () => {
    mockResult = {
      data: [
        {
          alert_id: "a-1",
          facility_id: "f-1",
          facility_name: "Oakridge ALF",
          title: "Variance",
          category: "clinical",
          severity: "medium",
          status: "new",
          source_metric_code: "emar_variance_pct",
          first_triggered_at: "2026-04-24T11:00:00-04:00",
        },
      ],
      error: null,
    };
    const load = await loadV2List("alerts");
    expect(load.rows[0]!.severity).toBe("medium");
    expect(load.rows[0]!.primary).toBe("Variance");
    expect(load.rows[0]!.secondary).toBe("clinical");
  });
});
