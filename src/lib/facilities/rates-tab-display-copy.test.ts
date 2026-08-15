import { describe, expect, it } from "vitest";

import {
  RATES_TAB_NO_CHANGES_COPY,
  RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY,
  RATES_TAB_NO_RATE_POSTED_COPY,
  RATES_TAB_NO_ROOMS_POSTED_COPY,
  formatRatesTabEditorDisplay,
  formatRatesTabLastChangedSuffix,
  formatRatesTabOccupiedCountDisplay,
  formatRatesTabPublishedRateDisplay,
  formatRatesTabRoomCountDisplay,
} from "./rates-tab-display-copy";
import { THRESHOLDS_TAB_NO_EDITOR_COPY } from "./thresholds-tab-display-copy";

const EM_DASH = "—";

describe("formatRatesTabPublishedRateDisplay", () => {
  it("names a missing published rate instead of an em dash", () => {
    expect(formatRatesTabPublishedRateDisplay("private_room_monthly", null)).toBe(RATES_TAB_NO_RATE_POSTED_COPY);
    expect(formatRatesTabPublishedRateDisplay("private_room_monthly", undefined)).toBe(RATES_TAB_NO_RATE_POSTED_COPY);
    expect(formatRatesTabPublishedRateDisplay("private_room_monthly", null)).not.toBe(EM_DASH);
  });

  it("formats zero cents as $0.00", () => {
    expect(formatRatesTabPublishedRateDisplay("private_room_monthly", 0)).toBe("$0.00 / mo");
    expect(formatRatesTabPublishedRateDisplay("respite_daily", 0)).toBe("$0.00 / day");
  });

  it("formats a posted monthly amount", () => {
    expect(formatRatesTabPublishedRateDisplay("private_room_monthly", 450000)).toBe("$4,500.00 / mo");
  });

  it("formats a posted daily amount", () => {
    expect(formatRatesTabPublishedRateDisplay("respite_daily", 12500)).toBe("$125.00 / day");
  });
});

describe("formatRatesTabEditorDisplay", () => {
  it("names a missing editor instead of an em dash", () => {
    expect(formatRatesTabEditorDisplay(null)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatRatesTabEditorDisplay(undefined)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatRatesTabEditorDisplay("")).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatRatesTabEditorDisplay(EM_DASH)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatRatesTabEditorDisplay(null)).not.toBe(EM_DASH);
  });

  it("truncates long editor identifiers", () => {
    expect(formatRatesTabEditorDisplay("abcdefghijklmnop")).toBe("abcdefgh…");
  });

  it("returns a short posted editor name trimmed", () => {
    expect(formatRatesTabEditorDisplay("  Jane Ops  ")).toBe("Jane Ops");
  });
});

describe("formatRatesTabRoomCountDisplay", () => {
  it("names missing room inventory instead of an em dash", () => {
    expect(formatRatesTabRoomCountDisplay(null)).toBe(RATES_TAB_NO_ROOMS_POSTED_COPY);
    expect(formatRatesTabRoomCountDisplay(undefined)).toBe(RATES_TAB_NO_ROOMS_POSTED_COPY);
    expect(formatRatesTabRoomCountDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats zero rooms as a real count", () => {
    expect(formatRatesTabRoomCountDisplay(0)).toBe("0 rooms");
    expect(formatRatesTabRoomCountDisplay(0)).not.toBe(RATES_TAB_NO_ROOMS_POSTED_COPY);
  });

  it("formats a posted positive room count", () => {
    expect(formatRatesTabRoomCountDisplay(12)).toBe("12 rooms");
  });
});

describe("formatRatesTabOccupiedCountDisplay", () => {
  it("names missing occupied count instead of an em dash", () => {
    expect(formatRatesTabOccupiedCountDisplay(null)).toBe(RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY);
    expect(formatRatesTabOccupiedCountDisplay(undefined)).toBe(RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY);
    expect(formatRatesTabOccupiedCountDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats zero occupied as a real count", () => {
    expect(formatRatesTabOccupiedCountDisplay(0)).toBe("0 occupied");
    expect(formatRatesTabOccupiedCountDisplay(0)).not.toBe(RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY);
  });

  it("formats a posted positive occupied count", () => {
    expect(formatRatesTabOccupiedCountDisplay(8)).toBe("8 occupied");
  });
});

describe("formatRatesTabLastChangedSuffix", () => {
  it("names missing change history instead of an em dash", () => {
    expect(formatRatesTabLastChangedSuffix(null, "")).toBe(RATES_TAB_NO_CHANGES_COPY);
    expect(formatRatesTabLastChangedSuffix(null, "")).not.toBe(EM_DASH);
  });

  it("combines timestamp with editor display", () => {
    expect(
      formatRatesTabLastChangedSuffix(
        { at: "2026-01-01T12:00:00.000Z", by: "Jane Operator" },
        "Jan 1, 2026 · 7:00 AM",
      ),
    ).toBe("Jan 1, 2026 · 7:00 AM by Jane Operator");
  });
});
