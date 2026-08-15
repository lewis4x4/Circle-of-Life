import { describe, expect, it } from "vitest";

import {
  ADMIN_FORM_NO_VALUE_COPY,
  formatAdminFormFieldValue,
} from "./forms-display-copy";

const EM_DASH = "—";

describe("formatAdminFormFieldValue", () => {
  it("names null and undefined gaps", () => {
    expect(formatAdminFormFieldValue(null)).toBe(ADMIN_FORM_NO_VALUE_COPY);
    expect(formatAdminFormFieldValue(undefined)).toBe(ADMIN_FORM_NO_VALUE_COPY);
    expect(formatAdminFormFieldValue(null)).not.toBe(EM_DASH);
  });

  it("names empty string as a gap", () => {
    expect(formatAdminFormFieldValue("")).toBe(ADMIN_FORM_NO_VALUE_COPY);
  });

  it("keeps real zero as posted", () => {
    expect(formatAdminFormFieldValue(0)).toBe("0");
  });

  it("formats posted string values unchanged", () => {
    expect(formatAdminFormFieldValue("Sample field text")).toBe("Sample field text");
  });
});
