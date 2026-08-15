import { describe, expect, it } from "vitest";

import { FACILITY_SECONDARY_TAB_NO_VALUE_COPY } from "./secondary-tab-metrics-display-copy";

describe("secondary-tab-metrics-display-copy", () => {
  it("names missing KPI values instead of a silent dash", () => {
    expect(FACILITY_SECONDARY_TAB_NO_VALUE_COPY).toBe("No value posted");
    expect(FACILITY_SECONDARY_TAB_NO_VALUE_COPY).not.toBe("—");
  });
});
