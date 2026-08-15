import { describe, expect, it } from "vitest";

import {
  THRESHOLDS_TAB_NO_CHANGES_COPY,
  THRESHOLDS_TAB_NO_EDITOR_COPY,
  formatThresholdsTabEditorDisplay,
  formatThresholdsTabLastChangedSuffix,
  formatThresholdsStripLastChanged,
} from "./thresholds-tab-display-copy";

const EM_DASH = "—";

describe("formatThresholdsTabEditorDisplay", () => {
  it("names a missing editor instead of an em dash", () => {
    expect(formatThresholdsTabEditorDisplay(null)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay(undefined)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay("")).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay("   ")).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay(EM_DASH)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay(`  ${EM_DASH}  `)).toBe(THRESHOLDS_TAB_NO_EDITOR_COPY);
    expect(formatThresholdsTabEditorDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns a posted editor name trimmed", () => {
    expect(formatThresholdsTabEditorDisplay("  Jane Operator  ")).toBe("Jane Operator");
  });
});

describe("formatThresholdsTabLastChangedSuffix", () => {
  it("names missing changes instead of an em dash", () => {
    expect(formatThresholdsTabLastChangedSuffix(null, "2 days ago")).toBe(THRESHOLDS_TAB_NO_CHANGES_COPY);
    expect(formatThresholdsTabLastChangedSuffix(null, "2 days ago")).not.toBe(EM_DASH);
  });

  it("combines relative time with editor display", () => {
    expect(
      formatThresholdsTabLastChangedSuffix(
        { updated_by_display: "  Alex Admin  " },
        "about 1 hour ago",
      ),
    ).toBe("about 1 hour ago by Alex Admin");
    expect(
      formatThresholdsTabLastChangedSuffix({ updated_by_display: null }, "about 1 hour ago"),
    ).toBe(`about 1 hour ago by ${THRESHOLDS_TAB_NO_EDITOR_COPY}`);
  });
});

describe("formatThresholdsStripLastChanged", () => {
  it("names missing threshold saves instead of an em dash", () => {
    expect(formatThresholdsStripLastChanged(null, "")).toBe(THRESHOLDS_TAB_NO_CHANGES_COPY);
    expect(formatThresholdsStripLastChanged(new Date("invalid"), "2 days ago")).toBe(THRESHOLDS_TAB_NO_CHANGES_COPY);
    expect(formatThresholdsStripLastChanged(null, "")).not.toBe(EM_DASH);
  });

  it("returns a formatted relative time when a save exists", () => {
    const changed = new Date("2026-01-01T12:00:00.000Z");
    expect(formatThresholdsStripLastChanged(changed, "about 2 hours ago")).toBe("about 2 hours ago");
  });
});
