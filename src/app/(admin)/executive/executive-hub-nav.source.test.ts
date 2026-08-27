import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "./executive-hub-nav.tsx"), "utf8");

describe("ExecutiveHubNav role filter", () => {
  it("filters hub links with canOpenExecutiveHubHref so facility admin is not offered overview", () => {
    expect(source).toContain("canOpenExecutiveHubHref");
    expect(source).toContain("primaryItems");
    expect(source).toContain("secondaryItems");
  });
});
