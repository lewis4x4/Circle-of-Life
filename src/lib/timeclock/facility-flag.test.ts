import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

import { timeclockFlagForFacility, timeclockFlagForUser } from "./facility-flag";

type Result = { data: unknown; error: unknown };

/** A chainable PostgREST stand-in: every filter returns itself; awaiting or maybeSingle() yields the table's result. */
function adminWith(results: Record<string, Result>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.maybeSingle = async () => result;
    builder.then = (resolve: (value: Result) => unknown) => resolve(result);
    return builder;
  });
  return { admin: { from } as unknown as SupabaseClient<Database>, calls };
}

describe("timeclockFlagForFacility", () => {
  it("is on only when the facility's settings row says so", async () => {
    expect(await timeclockFlagForFacility(adminWith({ timeclock_facility_settings: { data: { timeclock_enabled: true }, error: null } }).admin, "o1", "f1")).toBe("on");
    expect(await timeclockFlagForFacility(adminWith({ timeclock_facility_settings: { data: { timeclock_enabled: false }, error: null } }).admin, "o1", "f1")).toBe("off");
  });

  it("treats a missing settings row as off", async () => {
    expect(await timeclockFlagForFacility(adminWith({}).admin, "o1", "f1")).toBe("off");
  });

  it("reports unknown when the read fails", async () => {
    expect(await timeclockFlagForFacility(adminWith({ timeclock_facility_settings: { data: null, error: { code: "500" } } }).admin, "o1", "f1")).toBe("unknown");
  });

  it("scopes the read to the organization and facility it was given", async () => {
    const { admin, calls } = adminWith({ timeclock_facility_settings: { data: { timeclock_enabled: true }, error: null } });
    await timeclockFlagForFacility(admin, "o1", "f1");
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["organization_id", "o1"], ["facility_id", "f1"]]);
  });
});

describe("timeclockFlagForUser", () => {
  const base = {
    user_profiles: { data: { organization_id: "o1" }, error: null },
    user_facility_access: { data: [{ facility_id: "f1" }], error: null },
    staff: { data: [{ facility_id: "f2" }], error: null },
  };

  it("is on when any facility the user works at has the kiosk on", async () => {
    const { admin, calls } = adminWith({ ...base, timeclock_facility_settings: { data: [{ facility_id: "f2" }], error: null } });
    expect(await timeclockFlagForUser(admin, "u1")).toBe("on");
    const inCall = calls.find((c) => c.table === "timeclock_facility_settings" && c.method === "in");
    expect(inCall?.args).toEqual(["facility_id", ["f1", "f2"]]);
  });

  it("is off when none of them do, or the user has no facility", async () => {
    expect(await timeclockFlagForUser(adminWith({ ...base, timeclock_facility_settings: { data: [], error: null } }).admin, "u1")).toBe("off");
    expect(await timeclockFlagForUser(adminWith({ ...base, user_facility_access: { data: [], error: null }, staff: { data: [], error: null } }).admin, "u1")).toBe("off");
  });

  it("reports unknown when a read fails", async () => {
    expect(await timeclockFlagForUser(adminWith({ ...base, staff: { data: null, error: { code: "500" } } }).admin, "u1")).toBe("unknown");
  });
});
