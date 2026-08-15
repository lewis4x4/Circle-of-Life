import { describe, expect, it } from "vitest";

import {
  V2_USERS_NO_EMAIL_COPY,
  V2_USERS_NO_LAST_LOGIN_COPY,
  V2_USERS_NO_NAME_COPY,
  V2_USERS_NO_ROLE_COPY,
  V2_USERS_NO_TITLE_COPY,
  formatV2UsersEmailDisplay,
  formatV2UsersJobTitleDisplay,
  formatV2UsersLastLoginDisplay,
  formatV2UsersNameDisplay,
  formatV2UsersRoleDisplay,
} from "./v2-users-display-copy";

const EM_DASH = "—";
const PLACEHOLDER_NAME = "Jordan Lee";
const PLACEHOLDER_EMAIL = "operator@example.com";
const PLACEHOLDER_ROLE = "facility_admin";
const PLACEHOLDER_TITLE = "Executive Director";
const PLACEHOLDER_LAST_LOGIN = "2026-04-08T14:30:00.000Z";

describe("formatV2UsersNameDisplay", () => {
  it("names missing name instead of a silent dash", () => {
    expect(formatV2UsersNameDisplay(null)).toBe(V2_USERS_NO_NAME_COPY);
    expect(formatV2UsersNameDisplay(undefined)).toBe(V2_USERS_NO_NAME_COPY);
    expect(formatV2UsersNameDisplay("")).toBe(V2_USERS_NO_NAME_COPY);
    expect(formatV2UsersNameDisplay("   ")).toBe(V2_USERS_NO_NAME_COPY);
    expect(formatV2UsersNameDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns posted name trimmed as-is", () => {
    expect(formatV2UsersNameDisplay(PLACEHOLDER_NAME)).toBe(PLACEHOLDER_NAME);
    expect(formatV2UsersNameDisplay(`  ${PLACEHOLDER_NAME}  `)).toBe(PLACEHOLDER_NAME);
  });
});

describe("formatV2UsersEmailDisplay", () => {
  it("names missing email instead of a silent dash", () => {
    expect(formatV2UsersEmailDisplay(null)).toBe(V2_USERS_NO_EMAIL_COPY);
    expect(formatV2UsersEmailDisplay(undefined)).toBe(V2_USERS_NO_EMAIL_COPY);
    expect(formatV2UsersEmailDisplay("")).toBe(V2_USERS_NO_EMAIL_COPY);
    expect(formatV2UsersEmailDisplay("   ")).toBe(V2_USERS_NO_EMAIL_COPY);
    expect(formatV2UsersEmailDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns posted email trimmed as-is", () => {
    expect(formatV2UsersEmailDisplay(PLACEHOLDER_EMAIL)).toBe(PLACEHOLDER_EMAIL);
    expect(formatV2UsersEmailDisplay(`  ${PLACEHOLDER_EMAIL}  `)).toBe(PLACEHOLDER_EMAIL);
  });
});

describe("formatV2UsersRoleDisplay", () => {
  it("names missing role instead of a silent dash", () => {
    expect(formatV2UsersRoleDisplay(null)).toBe(V2_USERS_NO_ROLE_COPY);
    expect(formatV2UsersRoleDisplay(undefined)).toBe(V2_USERS_NO_ROLE_COPY);
    expect(formatV2UsersRoleDisplay("")).toBe(V2_USERS_NO_ROLE_COPY);
    expect(formatV2UsersRoleDisplay("   ")).toBe(V2_USERS_NO_ROLE_COPY);
    expect(formatV2UsersRoleDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns posted role trimmed as-is", () => {
    expect(formatV2UsersRoleDisplay(PLACEHOLDER_ROLE)).toBe(PLACEHOLDER_ROLE);
    expect(formatV2UsersRoleDisplay(`  ${PLACEHOLDER_ROLE}  `)).toBe(PLACEHOLDER_ROLE);
  });
});

describe("formatV2UsersJobTitleDisplay", () => {
  it("names missing job title instead of a silent dash", () => {
    expect(formatV2UsersJobTitleDisplay(null)).toBe(V2_USERS_NO_TITLE_COPY);
    expect(formatV2UsersJobTitleDisplay(undefined)).toBe(V2_USERS_NO_TITLE_COPY);
    expect(formatV2UsersJobTitleDisplay("")).toBe(V2_USERS_NO_TITLE_COPY);
    expect(formatV2UsersJobTitleDisplay("   ")).toBe(V2_USERS_NO_TITLE_COPY);
    expect(formatV2UsersJobTitleDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns posted job title trimmed as-is", () => {
    expect(formatV2UsersJobTitleDisplay(PLACEHOLDER_TITLE)).toBe(PLACEHOLDER_TITLE);
    expect(formatV2UsersJobTitleDisplay(`  ${PLACEHOLDER_TITLE}  `)).toBe(PLACEHOLDER_TITLE);
  });
});

describe("formatV2UsersLastLoginDisplay", () => {
  it("names missing last login instead of a silent dash", () => {
    expect(formatV2UsersLastLoginDisplay(null)).toBe(V2_USERS_NO_LAST_LOGIN_COPY);
    expect(formatV2UsersLastLoginDisplay(undefined)).toBe(V2_USERS_NO_LAST_LOGIN_COPY);
    expect(formatV2UsersLastLoginDisplay("")).toBe(V2_USERS_NO_LAST_LOGIN_COPY);
    expect(formatV2UsersLastLoginDisplay("   ")).toBe(V2_USERS_NO_LAST_LOGIN_COPY);
    expect(formatV2UsersLastLoginDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats posted last login with T replaced and sliced to 19 characters", () => {
    expect(formatV2UsersLastLoginDisplay(PLACEHOLDER_LAST_LOGIN)).toBe("2026-04-08 14:30:00");
    expect(formatV2UsersLastLoginDisplay(`  ${PLACEHOLDER_LAST_LOGIN}  `)).toBe(
      "2026-04-08 14:30:00",
    );
  });
});
