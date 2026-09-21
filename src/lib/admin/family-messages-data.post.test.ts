import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import { postStaffMessage } from "./family-messages-data";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const OTHER_FACILITY = "44444444-4444-4444-8444-444444444444";
const RESIDENT = "22222222-2222-4222-8222-222222222222";
const ORG = "55555555-5555-4555-8555-555555555555";

type ResidentRow = {
  facility_id: string;
  organization_id: string;
  status: string;
};

function createClient(options: {
  user: { id: string } | null;
  resident: { data: ResidentRow | null; error: { message: string } | null };
  insertError?: { message: string } | null;
}) {
  const filters: Array<[string, unknown]> = [];
  const inserts: unknown[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: options.user } }),
    },
    from(table: string) {
      if (table === "residents") {
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
          },
          is: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
          },
          maybeSingle: async () => options.resident,
        };
        return builder;
      }
      if (table === "family_portal_messages") {
        return {
          insert: async (row: unknown) => {
            inserts.push(row);
            return { error: options.insertError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return {
    filters,
    inserts,
    client: client as unknown as SupabaseClient<Database>,
  };
}

describe("postStaffMessage facility revalidation", () => {
  it("inserts only after the resident is still active in the selected facility", async () => {
    const fake = createClient({
      user: { id: "user-1" },
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "active" },
        error: null,
      },
    });

    const result = await postStaffMessage(
      fake.client,
      RESIDENT,
      " Ada ate lunch. ",
      "portal_only",
      FACILITY,
    );

    expect(result).toEqual({ ok: true });
    expect(fake.filters).toEqual([
      ["id", RESIDENT],
      ["facility_id", FACILITY],
      ["status", "active"],
      ["deleted_at", null],
    ]);
    expect(fake.inserts).toEqual([
      {
        organization_id: ORG,
        facility_id: FACILITY,
        resident_id: RESIDENT,
        author_user_id: "user-1",
        author_kind: "staff",
        body: "Ada ate lunch.",
        delivery_method: "portal_only",
      },
    ]);
  });

  it("does not insert when the resident is outside the selected facility", async () => {
    const fake = createClient({
      user: { id: "user-1" },
      resident: { data: null, error: null },
    });

    const result = await postStaffMessage(
      fake.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      OTHER_FACILITY,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not an active resident of the selected facility/i);
    expect(fake.inserts).toEqual([]);
    expect(fake.filters).toContainEqual(["facility_id", OTHER_FACILITY]);
  });

  it("does not insert when the current read is denied or the insert fails", async () => {
    const denied = createClient({
      user: { id: "user-1" },
      resident: { data: null, error: { message: "permission denied for table residents" } },
    });
    const deniedResult = await postStaffMessage(
      denied.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      FACILITY,
    );
    expect(deniedResult).toEqual({
      ok: false,
      error: "permission denied for table residents",
    });
    expect(denied.inserts).toEqual([]);

    const unsigned = createClient({
      user: null,
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "active" },
        error: null,
      },
    });
    const unsignedResult = await postStaffMessage(
      unsigned.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      FACILITY,
    );
    expect(unsignedResult).toEqual({ ok: false, error: "Not authenticated." });
    expect(unsigned.inserts).toEqual([]);

    const insertFailed = createClient({
      user: { id: "user-1" },
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "active" },
        error: null,
      },
      insertError: { message: "new row violates row-level security policy" },
    });
    const insertResult = await postStaffMessage(
      insertFailed.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      FACILITY,
    );
    expect(insertResult).toEqual({
      ok: false,
      error: "new row violates row-level security policy",
    });
  });

  it("does not insert a resident row that is not active in the facility being posted", async () => {
    const discharged = createClient({
      user: { id: "user-1" },
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "discharged" },
        error: null,
      },
    });
    const dischargedResult = await postStaffMessage(
      discharged.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      FACILITY,
    );
    expect(dischargedResult.ok).toBe(false);
    expect(discharged.inserts).toEqual([]);

    const otherFacility = createClient({
      user: { id: "user-1" },
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "active" },
        error: null,
      },
    });
    const otherResult = await postStaffMessage(
      otherFacility.client,
      RESIDENT,
      "About Ada",
      "portal_only",
      OTHER_FACILITY,
    );
    expect(otherResult.ok).toBe(false);
    expect(otherFacility.inserts).toEqual([]);
  });

  it("rejects a missing facility before reading or writing", async () => {
    const fake = createClient({
      user: { id: "user-1" },
      resident: {
        data: { facility_id: FACILITY, organization_id: ORG, status: "active" },
        error: null,
      },
    });
    const result = await postStaffMessage(fake.client, RESIDENT, "About Ada", "portal_only", "");
    expect(result.ok).toBe(false);
    expect(fake.filters).toEqual([]);
    expect(fake.inserts).toEqual([]);
  });
});
