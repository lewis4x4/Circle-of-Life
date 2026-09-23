import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** axe link-in-text-block (COL-705): links in running text are underlined, not colour-only. */
describe("links in text are underlined (COL-705)", () => {
  it("underlines every link inside a paragraph by default", () => {
    expect(read("src/app/globals.css")).toMatch(/:where\(p, dd, blockquote\) :where\(a\) \{\s*text-decoration-line: underline;/);
  });

  it.each([
    "src/app/(admin)/admin/referrals/hl7-inbound/page.tsx",
    "src/app/(admin)/admin/drive-cutover/page.tsx",
    "src/app/(admin)/reports/page.tsx",
    "src/components/common/source-readiness-callout.tsx",
  ])("%s has no colour-only link (underline only on hover)", (file) => {
    const hoverOnly = read(file)
      .match(/className="[^"]*"/g)
      ?.filter((cls) => cls.includes("hover:underline") && !/\sunderline\s|"underline\s/.test(cls));
    expect(hoverOnly ?? []).toEqual([]);
  });
});
