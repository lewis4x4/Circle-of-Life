import { describe, expect, it } from "vitest";

import { buildSnippet, rankPages, tokenize, type SearchablePage } from "./workspace-search";

const pages: SearchablePage[] = [
  {
    id: "1",
    title: "Fall prevention rounds",
    body: "Check high-risk residents hourly. Document fall risk in the care plan.",
    updated_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "2",
    title: "Dietary notes",
    body: "Thickened fluids for resident in room 3. No falls related content here.",
    updated_at: "2026-06-02T00:00:00Z",
  },
  {
    id: "3",
    title: "Shift summary",
    body: "Quiet night. Nothing to report.",
    updated_at: "2026-06-03T00:00:00Z",
  },
];

describe("tokenize", () => {
  it("drops stop words and short tokens", () => {
    expect(tokenize("What is my fall risk?")).toEqual(["fall", "risk"]);
  });
});

describe("rankPages", () => {
  it("ranks title matches above body-only matches", () => {
    const results = rankPages(pages, "fall risk");
    expect(results[0]?.page.id).toBe("1");
  });

  it("returns empty when the query has only stop words", () => {
    expect(rankPages(pages, "what is the")).toEqual([]);
  });

  it("excludes pages with no term overlap", () => {
    const results = rankPages(pages, "fall");
    expect(results.some((r) => r.page.id === "3")).toBe(false);
  });
});

describe("buildSnippet", () => {
  it("centers the snippet on a matching term", () => {
    const snippet = buildSnippet(pages[0].body, ["care"]);
    expect(snippet).toContain("care plan");
  });
});
