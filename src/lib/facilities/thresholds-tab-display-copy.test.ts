import { describe, expect, it } from "vitest";

import {
  THRESHOLDS_TAB_NO_CHANGES_COPY,
  THRESHOLDS_TAB_NO_EDITOR_COPY,
  formatThresholdsTabEditorDisplay,
  formatThresholdsTabLastChangedSuffix,
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
