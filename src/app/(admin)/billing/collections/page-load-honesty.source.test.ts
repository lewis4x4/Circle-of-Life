import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("collections hub load honesty", () => {
  it("uses the named hub cap and does not dump PostgREST error.message", () => {
    expect(source).toContain("COLLECTIONS_HUB_LIMIT");
    expect(source).toContain(".limit(COLLECTIONS_HUB_LIMIT)");
    expect(source).not.toContain(".limit(200)");
    expect(source).toContain("collectionsHubLoadCapNotice");
    expect(source).toContain("formatLiveDataLoadError");
    expect(source).not.toContain("e.message");
  });
});
