import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  flag: vi.fn(),
  requireActor: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  results: {} as Record<string, { data: unknown; error: unknown }>,
  insertResult: { data: { id: "new-record" }, error: null } as { data: unknown; error: unknown },
  updateResult: { error: null } as { error: unknown },
}));

vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: mock.requireActor }));
vi.mock("@/lib/timeclock/facility-flag", async () => {
  const copy = await import("@/lib/timeclock/front-door-copy");
  return { FRONT_DOOR_CLOCK_COPY: copy.FRONT_DOOR_CLOCK_COPY, timeclockFlagForFacility: mock.flag };
});
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";

function sessionClient() {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) builder[method] = () => builder;
      builder.maybeSingle = async () => mock.results[table] ?? { data: null, error: null };
      builder.insert = (row: unknown) => {
        mock.insert(table, row);
        return { select: () => ({ single: async () => mock.insertResult }) };
      };
      builder.update = (patch: unknown) => {
        mock.update(table, patch);
        const chain = { eq: () => chain, is: async () => mock.updateResult };
        return chain;
      };
      return builder;
    },
  };
}

function request(body: unknown): Request {
  return new Request("https://haven.example/api/caregiver/clock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.insertResult = { data: { id: "new-record" }, error: null };
  mock.updateResult = { error: null };
  mock.results = {
    staff: { data: { id: "s1", organization_id: "o1" }, error: null },
    time_records: { data: { id: RECORD, facility_id: FACILITY }, error: null },
  };
  mock.requireActor.mockResolvedValue({ actor: { id: "u1", organizationId: "o1", client: sessionClient(), admin: {} } });
});

describe("POST /api/caregiver/clock", () => {
  it("refuses a clock in with 409 and writes nothing where the front-door kiosk is on", async () => {
    mock.flag.mockResolvedValue("on");
    const response = await POST(request({ action: "in", facility_id: FACILITY }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Clock in at the front door.", code: "front_door_clock" });
    expect(mock.flag).toHaveBeenCalledWith({}, "o1", FACILITY);
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("refuses a clock out the same way, checking the open punch's own facility", async () => {
    mock.flag.mockResolvedValue("on");
    const response = await POST(request({ action: "out", time_record_id: RECORD }));
    expect(response.status).toBe(409);
    expect(mock.flag).toHaveBeenCalledWith({}, "o1", FACILITY);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("lets the database decide when the flag cannot be read: its one-clock policy refusal is a 409", async () => {
    // The service role holds no grant on timeclock_facility_settings; migration 494's
    // restrictive time_records policies enforce the rule for the caller's own session.
    mock.flag.mockResolvedValue("unknown");
    mock.insertResult = { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
    const refused = await POST(request({ action: "in", facility_id: FACILITY }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Clock in at the front door.", code: "front_door_clock" });

    mock.updateResult = { error: { code: "42501", message: "new row violates row-level security policy" } };
    expect((await POST(request({ action: "out", time_record_id: RECORD }))).status).toBe(409);
  });

  it("still punches when the flag cannot be read and the database allows it (flag off)", async () => {
    mock.flag.mockResolvedValue("unknown");
    const response = await POST(request({ action: "in", facility_id: FACILITY }));
    expect(response.status).toBe(200);
    expect(mock.insert).toHaveBeenCalled();
  });

  it("keeps the mobile punch where the flag is off", async () => {
    mock.flag.mockResolvedValue("off");
    const response = await POST(request({ action: "in", facility_id: FACILITY }));
    expect(response.status).toBe(200);
    expect(mock.insert).toHaveBeenCalledWith("time_records", expect.objectContaining({
      staff_id: "s1", facility_id: FACILITY, organization_id: "o1", clock_in_method: "mobile", created_by: "u1",
    }));
    const out = await POST(request({ action: "out", time_record_id: RECORD }));
    expect(out.status).toBe(200);
    expect(mock.update).toHaveBeenCalledWith("time_records", expect.objectContaining({ clock_out_method: "mobile", updated_by: "u1" }));
  });

  it("rejects a malformed body before resolving the actor", async () => {
    const response = await POST(request({ action: "in", facility_id: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(mock.requireActor).not.toHaveBeenCalled();
  });

  it("passes the actor resolver's refusal through", async () => {
    mock.requireActor.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await POST(request({ action: "in", facility_id: FACILITY }));
    expect(response.status).toBe(401);
  });
});
