import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");

describe("family-messages short URL", () => {
  it("redirects /family-messages to the admin hub like other mirrored segments", () => {
    expect(source).toContain('"family-messages"');
    expect(source).toContain("destination: `/admin/${seg}`");
  });
});
