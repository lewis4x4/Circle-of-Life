import { describe, expect, it } from "vitest";

import {
  NOTIFICATIONS_NO_CHANNELS_COPY,
  NOTIFICATIONS_NO_ROLE_TARGETS_COPY,
  formatNotificationsChannelsDisplay,
  formatNotificationsRoleTargetsDisplay,
} from "./notifications-display-copy";

describe("formatNotificationsChannelsDisplay", () => {
  it("names missing channels", () => {
    expect(formatNotificationsChannelsDisplay(null)).toBe(NOTIFICATIONS_NO_CHANNELS_COPY);
    expect(formatNotificationsChannelsDisplay(undefined)).toBe(NOTIFICATIONS_NO_CHANNELS_COPY);
  });

  it("names empty channel array", () => {
    expect(formatNotificationsChannelsDisplay([])).toBe(NOTIFICATIONS_NO_CHANNELS_COPY);
  });

  it("joins one channel", () => {
    expect(formatNotificationsChannelsDisplay(["email"])).toBe("email");
  });

  it("joins several channels with comma separation", () => {
    expect(formatNotificationsChannelsDisplay(["email", "sms", "push"])).toBe(
      "email, sms, push",
    );
  });
});

describe("formatNotificationsRoleTargetsDisplay", () => {
  it("names missing role targets", () => {
    expect(formatNotificationsRoleTargetsDisplay(null)).toBe(NOTIFICATIONS_NO_ROLE_TARGETS_COPY);
    expect(formatNotificationsRoleTargetsDisplay(undefined)).toBe(
      NOTIFICATIONS_NO_ROLE_TARGETS_COPY,
    );
  });

  it("names empty role target array", () => {
    expect(formatNotificationsRoleTargetsDisplay([])).toBe(NOTIFICATIONS_NO_ROLE_TARGETS_COPY);
  });

  it("joins one role target", () => {
    expect(formatNotificationsRoleTargetsDisplay(["nurse"])).toBe("nurse");
  });

  it("joins several role targets with comma separation", () => {
    expect(formatNotificationsRoleTargetsDisplay(["nurse", "admin", "med_tech"])).toBe(
      "nurse, admin, med_tech",
    );
  });
});
