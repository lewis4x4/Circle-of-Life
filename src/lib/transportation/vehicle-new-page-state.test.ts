import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  VEHICLE_NEW_ENTER_NAME_SUBMIT_COPY,
  VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY,
  VEHICLE_NEW_SELECT_FACILITY_SUBMIT_COPY,
  VEHICLE_NEW_SIGN_IN_SUBMIT_COPY,
  VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./vehicle-new-display-copy";
import {
  isVehicleNewSubmitBlocked,
  resolveVehicleNewFetchErrorBannerMessage,
  resolveVehicleNewOrganizationGapMessage,
  resolveVehicleNewSubmitButtonLabel,
} from "./vehicle-new-page-state";

describe("resolveVehicleNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveVehicleNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveVehicleNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveVehicleNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveVehicleNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("suppresses sign-in crash strings while auth hydrates", () => {
    expect(
      resolveVehicleNewFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Sign in required.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveVehicleNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table fleet_vehicles",
      }),
    ).toBe("permission denied for table fleet_vehicles");
  });
});

describe("isVehicleNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    user: { id: "usr-anon-1" },
    organizationId: "org-anon-1",
    facilityReady: true,
    name: "Van 1",
  };

  it("blocks while auth hydrates", () => {
    expect(isVehicleNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when signed out after auth resolves", () => {
    expect(isVehicleNewSubmitBlocked({ ...ready, user: null })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isVehicleNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("allows submit when org, facility, user, and name are present", () => {
    expect(isVehicleNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveVehicleNewSubmitButtonLabel", () => {
  const ready = {
    saving: false,
    authLoading: false,
    user: { id: "usr-anon-1" },
    organizationId: "org-anon-1",
    facilityReady: true,
    name: "Van 1",
  };

  it("names the wait while auth hydrates", () => {
    expect(resolveVehicleNewSubmitButtonLabel({ ...ready, authLoading: true })).toBe(
      VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });

  it("names sign-in when auth resolved without a user", () => {
    expect(resolveVehicleNewSubmitButtonLabel({ ...ready, user: null })).toBe(
      VEHICLE_NEW_SIGN_IN_SUBMIT_COPY,
    );
  });

  it("names missing organization when auth resolved without org", () => {
    expect(resolveVehicleNewSubmitButtonLabel({ ...ready, organizationId: null })).toBe(
      VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY,
    );
  });

  it("names facility selection when facility is not ready", () => {
    expect(resolveVehicleNewSubmitButtonLabel({ ...ready, facilityReady: false })).toBe(
      VEHICLE_NEW_SELECT_FACILITY_SUBMIT_COPY,
    );
  });

  it("names missing vehicle name when name is blank", () => {
    expect(resolveVehicleNewSubmitButtonLabel({ ...ready, name: "  " })).toBe(
      VEHICLE_NEW_ENTER_NAME_SUBMIT_COPY,
    );
  });
});
