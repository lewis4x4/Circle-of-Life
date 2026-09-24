import { describe, expect, it } from "vitest";

import { loadFamilyBuildingName } from "@/lib/family/family-building";

type Rows = Record<string, { data: unknown; error: null | { message: string } }>;

function fakeClient(rows: Rows) {
  const chain = (table: string) => {
    const result = rows[table];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => result;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  };
  return { from: chain } as never;
}

describe("loadFamilyBuildingName", () => {
  it("names the one building the linked residents live in", async () => {
    const client = fakeClient({
      family_resident_links: { data: [{ resident_id: "r1" }, { resident_id: "r2" }], error: null },
      residents: { data: [{ facility_id: "f1" }, { facility_id: "f1" }], error: null },
      facilities: { data: { name: " Homewood Lodge, ALF " }, error: null },
    });
    expect(await loadFamilyBuildingName(client, "u")).toBe("Homewood Lodge, ALF");
  });

  it("names none when the residents live in different buildings, or a read fails", async () => {
    expect(
      await loadFamilyBuildingName(
        fakeClient({
          family_resident_links: { data: [{ resident_id: "r1" }, { resident_id: "r2" }], error: null },
          residents: { data: [{ facility_id: "f1" }, { facility_id: "f2" }], error: null },
          facilities: { data: null, error: null },
        }),
        "u",
      ),
    ).toBeNull();
    expect(
      await loadFamilyBuildingName(
        fakeClient({
          family_resident_links: { data: null, error: { message: "denied" } },
          residents: { data: [], error: null },
          facilities: { data: null, error: null },
        }),
        "u",
      ),
    ).toBeNull();
  });
});
