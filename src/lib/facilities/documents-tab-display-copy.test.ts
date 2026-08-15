import { describe, expect, it } from "vitest";

import {
  DOCUMENTS_TAB_NO_UPLOADER_COPY,
  formatDocumentsTabUploaderDisplay,
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
