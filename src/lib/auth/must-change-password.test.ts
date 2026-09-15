import { describe, expect, it } from "vitest";
import {
  isChangePasswordExemptPath,
  mergeMustChangePasswordSetting,
  readMustChangePasswordFromSettings,
} from "./must-change-password";

describe("must-change-password helpers", () => {
  it("reads and merges settings flag", () => {
    expect(readMustChangePasswordFromSettings({ must_change_password: true })).toBe(true);
    expect(readMustChangePasswordFromSettings({})).toBe(false);
    expect(mergeMustChangePasswordSetting({}, true)).toEqual({ must_change_password: true });
    expect(mergeMustChangePasswordSetting({ must_change_password: true }, false)).toEqual({});
  });

  it("allows only password-related routes when forced", () => {
    expect(isChangePasswordExemptPath("/change-password")).toBe(true);
    expect(isChangePasswordExemptPath("/login")).toBe(true);
    expect(isChangePasswordExemptPath("/admin/settings/users")).toBe(false);
  });
});
