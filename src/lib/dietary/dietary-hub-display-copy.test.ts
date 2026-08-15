import { describe, expect, it } from "vitest";

import {
  DIETARY_HUB_NO_RESIDENT_COPY,
  formatDietaryHubResidentDisplay,
} from "./dietary-hub-display-copy";

describe("formatDietaryHubResidentDisplay", () => {
  it("names a missing residents join instead of generic unknown copy", () => {
    expect(formatDietaryHubResidentDisplay(null, null)).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
    expect(formatDietaryHubResidentDisplay(undefined, undefined)).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
  });

  it("names blank posted names instead of inventing a label", () => {
    expect(formatDietaryHubResidentDisplay("", "")).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
    expect(formatDietaryHubResidentDisplay("   ", "  ")).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
    expect(formatDietaryHubResidentDisplay("Alex", "")).toBe("Alex");
    expect(formatDietaryHubResidentDisplay("", "Rivera")).toBe("Rivera");
  });

  it("returns a trimmed posted first and last name", () => {
    expect(formatDietaryHubResidentDisplay("Alex", "Rivera")).toBe("Alex Rivera");
    expect(formatDietaryHubResidentDisplay("  Alex  ", "  Rivera  ")).toBe("Alex Rivera");
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatDietaryHubResidentDisplay("Unknown", null)).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
    expect(formatDietaryHubResidentDisplay(null, "Unknown")).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
    expect(formatDietaryHubResidentDisplay("Unknown", "")).toBe(DIETARY_HUB_NO_RESIDENT_COPY);
  });
});
