import { describe, expect, it } from "vitest";

import {
  forecastResidentCountLabel,
  rentRollResidentCountLabel,
} from "./money-page-counts";

describe("money page resident counts say what they count (COL-667)", () => {
  it("labels Homewood's 43 / 34 by their filters", () => {
    expect(rentRollResidentCountLabel(43, "September 2026")).toBe(
      "43 residents on the September 2026 roll (in the building at any point in the month)",
    );
    expect(forecastResidentCountLabel(34)).toBe("34 residents active today in scope");
    expect(rentRollResidentCountLabel(1, "May 2026")).toMatch(/^1 resident on/);
  });
});
