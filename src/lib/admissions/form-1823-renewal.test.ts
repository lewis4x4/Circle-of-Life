import { describe, expect, it } from "vitest";

import {
  defaultForm1823Expiration,
  shouldRequireForm1823RenewalOnPresenceChange,
} from "./form-1823-renewal";

describe("form-1823-renewal", () => {
  it("defaults expiration to exam_date + 365 days", () => {
    expect(defaultForm1823Expiration("2026-07-08")).toBe("2027-07-08");
  });

  it("requires renewal when returning from hospital_hold to active", () => {
    expect(
      shouldRequireForm1823RenewalOnPresenceChange({
        previousDbStatus: "hospital_hold",
        nextDbStatus: "active",
      }),
    ).toBe(true);
    expect(
      shouldRequireForm1823RenewalOnPresenceChange({
        previousDbStatus: "active",
        nextDbStatus: "hospital_hold",
      }),
    ).toBe(false);
  });
});
