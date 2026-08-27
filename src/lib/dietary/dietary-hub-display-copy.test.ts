import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DIET_ORDERS_HUB_LIMIT } from "./load-dietary-hub-bootstrap";
import {
  DIETARY_HUB_NO_RESIDENT_COPY,
  dietOrdersHubLoadCapNotice,
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

describe("dietOrdersHubLoadCapNotice", () => {
  it("stays quiet when the loaded list is under the hub cap", () => {
    expect(dietOrdersHubLoadCapNotice(0)).toBeNull();
    expect(dietOrdersHubLoadCapNotice(49)).toBeNull();
  });

  it("names the hub load cap when the fetch is full", () => {
    expect(dietOrdersHubLoadCapNotice(DIET_ORDERS_HUB_LIMIT)).toBe(
      `Loaded the ${DIET_ORDERS_HUB_LIMIT} most recent diet orders. Older orders are not listed on this hub.`,
    );
  });

  it("surfaces the cap notice on the dietary hub", () => {
    const client = readFileSync(
      path.join(process.cwd(), "src/components/dietary/AdminDietaryPageClient.tsx"),
      "utf8",
    );
    expect(client).toContain("dietOrdersHubLoadCapNotice");
    expect(client).toContain("dietOrderLoadCapNotice");
  });
});
