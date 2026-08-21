import { describe, expect, it } from "vitest";

import { DIET_MEAL_SNACK_LOG_LIMIT } from "@/lib/dietary/load-dietary-hub-bootstrap";

import {
  SNACK_PASS_LIST_LOADING_MESSAGE,
  SNACK_PASS_NO_PASSER_COPY,
  SNACK_PASS_RECENT_PREVIEW_LIMIT,
  formatSnackPassPasserDisplay,
  snackPassRecentPreviewFootnote,
  snackPassRecentPreviewRows,
} from "./snack-pass-display-copy";

describe("formatSnackPassPasserDisplay", () => {
  it("names a missing or blank passer instead of inventing Staff", () => {
    expect(formatSnackPassPasserDisplay(null)).toBe(SNACK_PASS_NO_PASSER_COPY);
    expect(formatSnackPassPasserDisplay(undefined)).toBe(SNACK_PASS_NO_PASSER_COPY);
    expect(formatSnackPassPasserDisplay("")).toBe(SNACK_PASS_NO_PASSER_COPY);
    expect(formatSnackPassPasserDisplay("   ")).toBe(SNACK_PASS_NO_PASSER_COPY);
    expect(formatSnackPassPasserDisplay("Staff")).toBe(SNACK_PASS_NO_PASSER_COPY);
    expect(formatSnackPassPasserDisplay("Staff")).not.toBe("Staff");
  });

  it("returns a trimmed posted passer name", () => {
    expect(formatSnackPassPasserDisplay("Jordan Lee")).toBe("Jordan Lee");
    expect(formatSnackPassPasserDisplay("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});

describe("snack pass recent preview", () => {
  it("keeps the first five loaded rows for the hub preview", () => {
    const logs = [1, 2, 3, 4, 5, 6, 7];
    expect(snackPassRecentPreviewRows(logs)).toEqual([1, 2, 3, 4, 5]);
    expect(SNACK_PASS_RECENT_PREVIEW_LIMIT).toBe(5);
  });

  it("stays quiet when the loaded list fits the preview", () => {
    expect(snackPassRecentPreviewFootnote(0)).toBeNull();
    expect(snackPassRecentPreviewFootnote(5)).toBeNull();
  });

  it("names a preview slice when more rows are loaded under the hub cap", () => {
    expect(snackPassRecentPreviewFootnote(8)).toBe("Showing 5 most recent of 8 loaded.");
  });

  it("names the hub load cap when the preview is sitting on a full fetch", () => {
    expect(snackPassRecentPreviewFootnote(DIET_MEAL_SNACK_LOG_LIMIT)).toBe(
      `Showing 5 most recent of ${DIET_MEAL_SNACK_LOG_LIMIT} loaded. Older passes are not listed on this hub.`,
    );
  });

  it("uses Quiet Operator loading copy for the recent list", () => {
    expect(SNACK_PASS_LIST_LOADING_MESSAGE).toBe("Loading snack passes…");
  });
});
