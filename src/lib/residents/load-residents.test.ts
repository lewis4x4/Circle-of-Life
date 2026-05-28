import { describe, expect, it, vi } from "vitest";

import { fetchResidentsFromSupabase } from "./load-residents";

type QueryResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function createResidentQuery(response: QueryResponse) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.then = (
    onFulfilled: (value: QueryResponse) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected);
  return query as Record<string, ReturnType<typeof vi.fn>> & {
    then: PromiseLike<QueryResponse>["then"];
  };
}

describe("fetchResidentsFromSupabase", () => {
  it("returns an empty careSummary instead of fabricating resident care text", async () => {
    const residentsQuery = createResidentQuery({
      data: [
        {
          id: "resident-1",
          first_name: "Ada",
          last_name: "Lovelace",
          facility_id: "00000000-0000-0000-0000-000000000001",
          status: "active",
          acuity_level: "level_2",
          updated_at: "2026-05-01T12:00:00.000Z",
          deleted_at: null,
          beds: [
            {
              id: "bed-1",
              bed_label: "A",
              room_id: "room-1",
              rooms: {
                id: "room-1",
                room_number: "101",
                unit_id: "unit-1",
                units: {
                  id: "unit-1",
                  name: "East Wing",
                },
              },
            },
          ],
        },
      ],
      error: null,
    });

    const supabase = {
      from: vi.fn(() => residentsQuery),
    };

    const [resident] = await fetchResidentsFromSupabase(
      "00000000-0000-0000-0000-000000000001",
      supabase as never,
    );

    expect(resident).toMatchObject({
      id: "resident-1",
      name: "Ada Lovelace",
      initials: "AL",
      room: "101-A",
      unit: "East Wing",
      acuity: 2,
      adlStatus: "assisted",
      status: "active",
      updatedAtIso: "2026-05-01T12:00:00.000Z",
    });
    expect(resident.careSummary).toBe("");
  });
});
