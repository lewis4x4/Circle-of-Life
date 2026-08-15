import { describe, expect, it } from "vitest";

import {
  EMERGENCY_CONTACTS_NO_HOURS_COPY,
  EMERGENCY_CONTACTS_NO_VERIFICATION_COPY,
} from "./emergency-contacts-display-copy";

describe("emergency-contacts-display-copy", () => {
  it("names missing verification instead of a silent dash", () => {
    expect(EMERGENCY_CONTACTS_NO_VERIFICATION_COPY).toBe("No verification posted");
    expect(EMERGENCY_CONTACTS_NO_VERIFICATION_COPY).not.toBe("—");
  });

  it("names missing hours instead of a silent dash", () => {
    expect(EMERGENCY_CONTACTS_NO_HOURS_COPY).toBe("No hours posted");
    expect(EMERGENCY_CONTACTS_NO_HOURS_COPY).not.toBe("—");
  });
});
