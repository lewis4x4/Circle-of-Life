import { describe, expect, it } from "vitest";

import {
  DOCUMENTS_TAB_EXPIRATION_REQUIRED_GAP_COPY,
  DOCUMENTS_TAB_NO_UPLOADER_COPY,
  formatDocumentsTabExpirationVisual,
  formatDocumentsTabUploaderDisplay,
  isDocumentsTabAttentionRequired,
} from "./documents-tab-display-copy";

const EM_DASH = "—";

describe("formatDocumentsTabUploaderDisplay", () => {
  it("names a missing uploader instead of generic Unknown or an em dash", () => {
    expect(formatDocumentsTabUploaderDisplay(null)).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay(undefined)).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay("")).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay("   ")).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay(EM_DASH)).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay("Unknown")).toBe(DOCUMENTS_TAB_NO_UPLOADER_COPY);
    expect(formatDocumentsTabUploaderDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns a posted uploader name trimmed", () => {
    expect(formatDocumentsTabUploaderDisplay("  Jane Operator  ")).toBe("Jane Operator");
  });
});

describe("formatDocumentsTabExpirationVisual", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("names a required-category gap when expiration_date is missing", () => {
    const visual = formatDocumentsTabExpirationVisual("fire_inspections", null, eightOhFivePmEt);
    expect(visual.line).toBe(DOCUMENTS_TAB_EXPIRATION_REQUIRED_GAP_COPY);
    expect(visual.className).toContain("text-warning");
  });

  it("treats a document expiring today as in-window after 8pm ET", () => {
    const visual = formatDocumentsTabExpirationVisual("fire_inspections", "2026-08-20", eightOhFivePmEt);
    expect(visual.line).toContain("in 0 days");
    expect(visual.className).toContain("text-warning");
    expect(visual.line).not.toContain("Expired");
  });

  it("marks yesterday as expired after 8pm ET", () => {
    const visual = formatDocumentsTabExpirationVisual("fire_inspections", "2026-08-19", eightOhFivePmEt);
    expect(visual.line).toContain("Expired 1 days ago");
    expect(visual.className).toContain("text-destructive");
  });
});

describe("isDocumentsTabAttentionRequired", () => {
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("includes required categories missing expiration_date", () => {
    expect(isDocumentsTabAttentionRequired("ahca_licensing", null, eightOhFivePmEt)).toBe(true);
  });

  it("excludes optional categories missing expiration_date", () => {
    expect(isDocumentsTabAttentionRequired("photos", null, eightOhFivePmEt)).toBe(false);
  });

  it("includes documents expiring today after 8pm ET", () => {
    expect(isDocumentsTabAttentionRequired("fire_inspections", "2026-08-20", eightOhFivePmEt)).toBe(true);
  });
});
