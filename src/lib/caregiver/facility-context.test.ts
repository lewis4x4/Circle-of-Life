import { beforeEach, expect, it } from "vitest";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { preferredFacilityId, selectWorkingFacility, workingFacilityKey } from "./facility-context";
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
