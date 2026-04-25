import { describe, expect, it } from "vitest";
import {
  mergeScope,
  parseScopeSearchParams,
  scopeSchema,
  writeScopeToSearchParams,
} from "./scope";

describe("UI-V2 scope", () => {
  it("round-trips Owner, Group, Facility, and DateRange through URL params", () => {
    const params = writeScopeToSearchParams({
      ownerId: "owner-1",
      groupId: "group-1",
      facilityIds: ["facility-1", "facility-2"],
      dateRange: {
        start: "2026-04-01",
        end: "2026-04-24",
      },
    });

    expect(params.toString()).toBe(
      "owner=owner-1&group=group-1&facility=facility-1&facility=facility-2&start=2026-04-01&end=2026-04-24",
    );
    expect(parseScopeSearchParams(params)).toEqual({
      ownerId: "owner-1",
      groupId: "group-1",
      facilityIds: ["facility-1", "facility-2"],
      dateRange: {
        start: "2026-04-01",
        end: "2026-04-24",
      },
    });
  });

  it("preserves unrelated search params when writing scope", () => {
    const params = writeScopeToSearchParams(
      { ownerId: "owner-1" },
      new URLSearchParams("tab=alerts&owner=old"),
    );

    expect(params.toString()).toBe("tab=alerts&owner=owner-1");
  });

  it("merges scope patches", () => {
    expect(
      mergeScope(
        {
          ownerId: "owner-1",
          facilityIds: ["facility-1"],
        },
        {
          groupId: "group-1",
          facilityIds: ["facility-2"],
        },
      ),
    ).toEqual({
      ownerId: "owner-1",
      groupId: "group-1",
      facilityIds: ["facility-2"],
    });
  });

  it("rejects malformed scope input", () => {
    expect(
      scopeSchema.safeParse({
        facilityIds: [""],
      }).success,
    ).toBe(false);

    expect(
      scopeSchema.safeParse({
        dateRange: {
          start: "2026-04-24",
          end: "2026-04-01",
        },
      }).success,
    ).toBe(false);
  });
});
