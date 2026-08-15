import { describe, expect, it } from "vitest";

import {
  formatInfectionControlHubKpiValue,
  infectionControlHubKpiTileIsMetric,
} from "./infection-control-display-copy";

describe("formatInfectionControlHubKpiValue", () => {
  it("returns named loading copy per tile", () => {
    expect(formatInfectionControlHubKpiValue("active_infections", 0, true)).toBe(
      "Loading infection count…",
    );
    expect(formatInfectionControlHubKpiValue("active_outbreaks", 3, true)).toBe(
      "Loading outbreak count…",
    );
    expect(formatInfectionControlHubKpiValue("open_vital_alerts", null, true)).toBe(
      "Loading alert count…",
    );
    expect(formatInfectionControlHubKpiValue("staff_out_sick", undefined, true)).toBe(
      "Loading staff-out count…",
    );
  });

  it("keeps real zero as numeric zero when loaded", () => {
    expect(formatInfectionControlHubKpiValue("active_infections", 0, false)).toBe(0);
    expect(formatInfectionControlHubKpiValue("active_outbreaks", 0, false)).toBe(0);
    expect(formatInfectionControlHubKpiValue("open_vital_alerts", 0, false)).toBe(0);
    expect(formatInfectionControlHubKpiValue("staff_out_sick", 0, false)).toBe(0);
  });

  it("returns posted positive counts unchanged", () => {
    expect(formatInfectionControlHubKpiValue("active_infections", 4, false)).toBe(4);
    expect(formatInfectionControlHubKpiValue("staff_out_sick", 2, false)).toBe(2);
  });

  it("names missing counts instead of silent em dashes", () => {
    expect(formatInfectionControlHubKpiValue("active_infections", null, false)).toBe(
      "No infection count posted",
    );
    expect(formatInfectionControlHubKpiValue("active_outbreaks", undefined, false)).toBe(
      "No outbreak count posted",
    );
    expect(formatInfectionControlHubKpiValue("open_vital_alerts", null, false)).toBe(
      "No alert count posted",
    );
    expect(formatInfectionControlHubKpiValue("staff_out_sick", undefined, false)).toBe(
      "No staff-out count posted",
    );
  });
});

describe("infectionControlHubKpiTileIsMetric", () => {
  it("treats numeric displays as metrics", () => {
    expect(infectionControlHubKpiTileIsMetric(0)).toBe(true);
    expect(infectionControlHubKpiTileIsMetric(7)).toBe(true);
  });

  it("treats gap copy as messages", () => {
    expect(infectionControlHubKpiTileIsMetric("Loading infection count…")).toBe(false);
    expect(infectionControlHubKpiTileIsMetric("No outbreak count posted")).toBe(false);
  });
});
