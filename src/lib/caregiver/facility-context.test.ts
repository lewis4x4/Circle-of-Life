import { beforeEach, expect, it } from "vitest";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { loadCaregiverFacilityContextForUser, preferredFacilityId, selectWorkingFacility, workingFacilityKey } from "./facility-context";
const a = { facilityId: "a", organizationId: "org", facilityName: "A", timeZone: "America/New_York" };
const b = { ...a, facilityId: "b", facilityName: "B" };
it("requires an explicit selection for multiple facilities", () => { expect(selectWorkingFacility([a,b], null)).toBeNull(); expect(selectWorkingFacility([a,b], "b")).toEqual(b); });
it("only automatically selects a single authorized facility", () => { expect(selectWorkingFacility([a], null)).toEqual(a); expect(selectWorkingFacility([a], "revoked")).toBeNull(); });

const HOMEWOOD = "3fa1b6d8-8f4b-4d7a-9f1e-2c0b5a7d4e11";
beforeEach(() => { sessionStorage.clear(); useFacilityStore.setState({ selectedFacilityId: null }); });

it("prefers the caller's explicit selection over stored preferences", () => {
  sessionStorage.setItem(workingFacilityKey("user-1"), "session-facility");
  useFacilityStore.setState({ selectedFacilityId: HOMEWOOD });
  expect(preferredFacilityId("user-1", "explicit-facility")).toBe("explicit-facility");
});

it("reads the shift header selection from session storage", () => {
  sessionStorage.setItem(workingFacilityKey("user-1"), "session-facility");
  expect(preferredFacilityId("user-1")).toBe("session-facility");
});

it("falls back to the admin shell facility picker when no shift was started", () => {
  useFacilityStore.setState({ selectedFacilityId: HOMEWOOD });
  expect(preferredFacilityId("user-1")).toBe(HOMEWOOD);
  expect(preferredFacilityId("user-1", "")).toBe(HOMEWOOD);
});

it("reports no preference when neither header has a selection", () => {
  expect(preferredFacilityId("user-1")).toBeNull();
});

function profileClient(result: { data: unknown; error: unknown }) {
  const grants = { data: [], error: null };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
    is: async () => grants,
  };
  return { from: () => query } as unknown as Parameters<typeof loadCaregiverFacilityContextForUser>[0];
}

it("never hands a database error to staff as the working-facility message", async () => {
  const dbError = Object.assign(new Error("permission denied for table user_profiles"), { code: "42501" });
  const result = await loadCaregiverFacilityContextForUser(profileClient({ data: null, error: dbError }), { userId: "user-1" });
  expect(result).toEqual({ ok: false, error: "Your working facility could not be loaded right now. Try again." });
});

it("keeps the staff-facing message for an account with no profile", async () => {
  const result = await loadCaregiverFacilityContextForUser(profileClient({ data: null, error: null }), { userId: "user-1" });
  expect(result).toEqual({ ok: false, error: "Your staff profile is unavailable." });
});

it("reads the profile and the facility grants at the same time", async () => {
  const started: string[] = [];
  let releaseProfile!: () => void;
  const profileGate = new Promise<void>((resolve) => { releaseProfile = resolve; });
  const client = {
    from: (table: string) => {
      started.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: "a", name: "A", organization_id: "org", timezone: null }], error: null }),
        maybeSingle: async () => { await profileGate; return { data: { organization_id: "org", app_role: "med_tech" }, error: null }; },
        is: (column: string) => (column === "revoked_at" ? Promise.resolve({ data: [{ facility_id: "a" }], error: null }) : query),
      };
      return query;
    },
  } as unknown as Parameters<typeof loadCaregiverFacilityContextForUser>[0];
  const pending = loadCaregiverFacilityContextForUser(client, { userId: "user-1" });
  await Promise.resolve();
  expect(started).toEqual(["user_profiles", "user_facility_access"]);
  releaseProfile();
  const result = await pending;
  expect(result).toEqual({ ok: true, ctx: { facilityId: "a", organizationId: "org", facilityName: "A", timeZone: "America/New_York" } });
});
