import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveTransportSettingsFetchErrorBannerMessage,
  resolveTransportSettingsOrganizationGapMessage,
} from "./transport-settings-page-state";

describe("resolveTransportSettingsOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveTransportSettingsOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveTransportSettingsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped settings are already on screen", () => {
    expect(
      resolveTransportSettingsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveTransportSettingsFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveTransportSettingsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveTransportSettingsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table organization_transport_settings",
      }),
    ).toBe("permission denied for table organization_transport_settings");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveTransportSettingsFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table organization_transport_settings",
      }),
    ).toBeNull();
  });
});
