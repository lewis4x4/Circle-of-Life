import { expect, it } from "vitest";
import { selectWorkingFacility } from "./facility-context";
const a = { facilityId: "a", organizationId: "org", facilityName: "A", timeZone: "America/New_York" };
const b = { ...a, facilityId: "b", facilityName: "B" };
it("requires an explicit selection for multiple facilities", () => { expect(selectWorkingFacility([a,b], null)).toBeNull(); expect(selectWorkingFacility([a,b], "b")).toEqual(b); });
it("only automatically selects a single authorized facility", () => { expect(selectWorkingFacility([a], null)).toEqual(a); expect(selectWorkingFacility([a], "revoked")).toBeNull(); });
