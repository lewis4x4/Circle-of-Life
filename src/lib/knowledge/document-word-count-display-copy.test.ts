import { describe, expect, it } from "vitest";

import {
  DOCUMENT_NO_WORD_COUNT_COPY,
  formatDocumentWordCount,
} from "./document-word-count-display-copy";

describe("formatDocumentWordCount", () => {
  it("names missing word count", () => {
    expect(formatDocumentWordCount(null)).toBe(DOCUMENT_NO_WORD_COUNT_COPY);
    expect(formatDocumentWordCount(undefined)).toBe(DOCUMENT_NO_WORD_COUNT_COPY);
  });

  it("keeps real zero locale-formatted", () => {
    expect(formatDocumentWordCount(0)).toBe((0).toLocaleString());
  });

  it("returns posted counts locale-formatted", () => {
    expect(formatDocumentWordCount(1234)).toBe((1234).toLocaleString());
  });
});
