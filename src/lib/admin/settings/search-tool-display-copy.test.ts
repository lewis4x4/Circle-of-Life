import { describe, expect, it } from "vitest";

import {
  SEARCH_TOOL_NO_EMAIL_COPY,
  formatSearchToolUserEmailDisplay,
} from "./search-tool-display-copy";

describe("formatSearchToolUserEmailDisplay", () => {
  it("names missing email instead of Unknown", () => {
    expect(formatSearchToolUserEmailDisplay(null)).toBe(SEARCH_TOOL_NO_EMAIL_COPY);
    expect(formatSearchToolUserEmailDisplay(undefined)).toBe(SEARCH_TOOL_NO_EMAIL_COPY);
    expect(formatSearchToolUserEmailDisplay(null)).not.toBe("Unknown");
  });

  it("names blank email instead of Unknown", () => {
    expect(formatSearchToolUserEmailDisplay("")).toBe(SEARCH_TOOL_NO_EMAIL_COPY);
    expect(formatSearchToolUserEmailDisplay("   ")).toBe(SEARCH_TOOL_NO_EMAIL_COPY);
  });

  it("returns posted email trimmed as-is", () => {
    expect(formatSearchToolUserEmailDisplay("operator@example.com")).toBe(
      "operator@example.com",
    );
    expect(formatSearchToolUserEmailDisplay("  operator@example.com  ")).toBe(
      "operator@example.com",
    );
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatSearchToolUserEmailDisplay("Unknown")).toBe(SEARCH_TOOL_NO_EMAIL_COPY);
  });
});
