import { describe, expect, it } from "vitest";

import {
  USER_AUDIT_NO_EMAIL_COPY,
  USER_AUDIT_NO_NAME_COPY,
  formatUserAuditActingUserEmailDisplay,
  formatUserAuditActingUserNameDisplay,
} from "./user-audit-display-copy";

const EM_DASH = "—";
const PLACEHOLDER_NAME = "Jordan Lee";
const PLACEHOLDER_EMAIL = "jordan.lee@example.com";

describe("formatUserAuditActingUserNameDisplay", () => {
  it("names a missing actor instead of generic Unknown copy", () => {
    expect(formatUserAuditActingUserNameDisplay(null)).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay(undefined)).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay(null)).not.toBe("Unknown");
  });

  it("names blank and em-dash values instead of a silent dash", () => {
    expect(formatUserAuditActingUserNameDisplay("")).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay("   ")).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay(EM_DASH)).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay(`  ${EM_DASH}  `)).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay("")).not.toBe(EM_DASH);
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatUserAuditActingUserNameDisplay("Unknown")).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay("unknown")).toBe(USER_AUDIT_NO_NAME_COPY);
    expect(formatUserAuditActingUserNameDisplay("  Unknown  ")).toBe(USER_AUDIT_NO_NAME_COPY);
  });

  it("returns posted name trimmed as-is", () => {
    expect(formatUserAuditActingUserNameDisplay(PLACEHOLDER_NAME)).toBe(PLACEHOLDER_NAME);
    expect(formatUserAuditActingUserNameDisplay(`  ${PLACEHOLDER_NAME}  `)).toBe(PLACEHOLDER_NAME);
  });
});

describe("formatUserAuditActingUserEmailDisplay", () => {
  it("names a missing actor email instead of generic unknown copy", () => {
    expect(formatUserAuditActingUserEmailDisplay(null)).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay(undefined)).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay(null)).not.toBe("unknown");
  });

  it("names blank and em-dash values instead of a silent dash", () => {
    expect(formatUserAuditActingUserEmailDisplay("")).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay("   ")).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay(EM_DASH)).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay(`  ${EM_DASH}  `)).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay("")).not.toBe(EM_DASH);
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatUserAuditActingUserEmailDisplay("Unknown")).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay("unknown")).toBe(USER_AUDIT_NO_EMAIL_COPY);
    expect(formatUserAuditActingUserEmailDisplay("  unknown  ")).toBe(USER_AUDIT_NO_EMAIL_COPY);
  });

  it("returns posted email trimmed as-is", () => {
    expect(formatUserAuditActingUserEmailDisplay(PLACEHOLDER_EMAIL)).toBe(PLACEHOLDER_EMAIL);
    expect(formatUserAuditActingUserEmailDisplay(`  ${PLACEHOLDER_EMAIL}  `)).toBe(
      PLACEHOLDER_EMAIL,
    );
  });
});
