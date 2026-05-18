import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
  listActorAccessibleFacilityIds: vi.fn(),
}));

import { POST } from "./route";
import {
  actorCanAccessFacility,
  listActorAccessibleFacilityIds,
  requireAdminApiActor,
} from "@/lib/admin/api-auth";

type QueryResult = { data: unknown; error: { message: string } | null };

class MockQuery implements PromiseLike<QueryResult> {
  private readonly table: string;
  private readonly state: MockAdminState;
  private filters: Record<string, unknown> = {};
  private maybeSingleMode = false;
  private singleMode = false;
  private insertedPayload: unknown = null;

  constructor(table: string, state: MockAdminState) {
    this.table = table;
    this.state = state;
  }

  select(columns: string) {
    void columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[`eq:${column}`] = value;
    return this;
  }

  in(column: string, values: unknown[]) {
    this.state.inCalls.push({ table: this.table, column, values });
    this.filters[`in:${column}`] = values;
    return this;
  }

  gte(column: string, value: unknown) {
    void column;
    void value;
    return this;
  }

  is(column: string, value: unknown) {
    void column;
    void value;
    return this;
  }

  order(column: string, options?: unknown) {
    void column;
    void options;
    return this;
  }

  limit(value: number) {
    if (this.table === "residents") this.state.residentLimit = value;
    return this;
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this;
  }

  single() {
    this.singleMode = true;
    return this;
  }

  insert(payload: unknown) {
    this.insertedPayload = payload;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    if (this.table === "ai_invocation_policies") {
      return { data: { allow_phi: true }, error: null };
    }
    if (this.table === "residents") {
      return { data: this.state.residents, error: null };
    }
    if (this.table === "facilities") {
      return { data: this.state.facilities, error: null };
    }

    if (this.table === "resident_observation_logs") {
      return { data: this.state.observations, error: null };
    }
    if (this.table === "incidents") {
      return { data: this.state.incidents, error: null };
    }
    if (this.table === "emar_records") {
      return { data: this.state.emars, error: null };
    }
    if (this.table === "assessments") {
      return { data: this.state.assessments, error: null };
    }
    if (this.table === "resident_safety_scores") {
      if (this.maybeSingleMode) {
        const residentId = this.filters["eq:resident_id"] as string;
        const match = this.state.safetyScores.find((row) => row.resident_id === residentId) ?? null;
        return { data: match, error: null };
      }
      return { data: this.state.safetyScores, error: null };
    }

    if (this.table === "ai_invocations") {
      return { data: this.singleMode ? { id: "invocation-1" } : null, error: null };
    }

    if (this.table === "resident_safety_insights") {
      this.state.insightInserts.push(this.insertedPayload as Record<string, unknown>);
      return { data: null, error: null };
    }

    if (this.table === "exec_alerts") {
      this.state.alertInserts.push(this.insertedPayload);
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }
}

type MockAdminState = {
  residentLimit: number | null;
  inCalls: Array<{ table: string; column: string; values: unknown[] }>;
  residents: Array<{ id: string; facility_id: string }>;
  facilities: Array<{ id: string; entity_id: string }>;
  observations: Array<{ resident_id: string; quick_status: string; exception_present: boolean }>;
  incidents: Array<{ resident_id: string; category: string; severity: string }>;
  emars: Array<{ resident_id: string; status: string; is_prn: boolean; prn_effectiveness_result: string | null }>;
  safetyScores: Array<{ resident_id: string; score: number; risk_tier: string; score_delta: number }>;
  assessments: Array<{ resident_id: string; assessment_type: string; total_score: number }>;
  insightInserts: Array<Record<string, unknown>>;
  alertInserts: unknown[];
};

const ORIGINAL_ENV = { ...process.env };

describe("/api/admin/rounding/insights/run", () => {
  let state: MockAdminState;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: "test-key" };

    state = {
      residentLimit: null,
      inCalls: [],
      residents: [
        { id: "resident-1", facility_id: "facility-1" },
        { id: "resident-2", facility_id: "facility-2" },
      ],
      facilities: [
        { id: "facility-1", entity_id: "entity-1" },
        { id: "facility-2", entity_id: "entity-2" },
      ],
      observations: [
        { resident_id: "resident-1", quick_status: "stable", exception_present: false },
        { resident_id: "resident-1", quick_status: "watch", exception_present: true },
        { resident_id: "resident-2", quick_status: "stable", exception_present: false },
      ],
      incidents: [
        { resident_id: "resident-1", category: "fall", severity: "low" },
        { resident_id: "resident-2", category: "behavior", severity: "medium" },
      ],
      emars: [
        { resident_id: "resident-1", status: "given", is_prn: false, prn_effectiveness_result: null },
        { resident_id: "resident-2", status: "given", is_prn: true, prn_effectiveness_result: "effective" },
      ],
      safetyScores: [
        { resident_id: "resident-2", score: 55, risk_tier: "medium", score_delta: 1 },
        { resident_id: "resident-1", score: 72, risk_tier: "low", score_delta: -2 },
      ],
      assessments: [
        { resident_id: "resident-1", assessment_type: "adl", total_score: 8 },
        { resident_id: "resident-2", assessment_type: "fall", total_score: 3 },
      ],
      insightInserts: [],
      alertInserts: [],
    };

    const admin = {
      from: (table: string) => new MockQuery(table, state),
    };

    vi.mocked(requireAdminApiActor).mockResolvedValue({
      actor: {
        id: "actor-1",
        organization_id: "org-1",
        admin,
      },
    } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    vi.mocked(listActorAccessibleFacilityIds).mockResolvedValue(["facility-1", "facility-2"]);

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  patterns: [
                    {
                      type: "pattern_detected",
                      severity: "medium",
                      title: "Pattern",
                      body: "Details",
                      clinical_domains: ["fall_risk"],
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("batches source table reads once across residents and preserves inserts", async () => {
    const req = new Request("http://localhost/api/admin/rounding/insights/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxResidents: 9999 }),
    });

    const response = await POST(req);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, residentsAnalyzed: 2, insightsGenerated: 2, alertsCreated: 0 });
    expect(state.residentLimit).toBe(25);

    const residentIdBatchCalls = state.inCalls.filter((call) => call.column === "resident_id");
    expect(residentIdBatchCalls).toHaveLength(5);
    for (const table of [
      "resident_observation_logs",
      "incidents",
      "emar_records",
      "resident_safety_scores",
      "assessments",
    ]) {
      const call = residentIdBatchCalls.find((item) => item.table === table);
      expect(call?.values).toEqual(["resident-1", "resident-2"]);
    }

    expect(state.insightInserts).toHaveLength(2);
    const byResident = Object.fromEntries(
      state.insightInserts.map((insert) => [insert.resident_id as string, insert]),
    );

    expect(byResident["resident-1"].facility_id).toBe("facility-1");
    expect(byResident["resident-1"].entity_id).toBe("entity-1");
    expect(byResident["resident-1"].source_data_json).toMatchObject({ observation_count: 2, incident_count: 1 });

    expect(byResident["resident-2"].facility_id).toBe("facility-2");
    expect(byResident["resident-2"].entity_id).toBe("entity-2");
    expect(byResident["resident-2"].source_data_json).toMatchObject({ observation_count: 1, incident_count: 1 });
  });
});
