import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-597 probe. `/admin/v2/residents/[id]` is a re-export of the resident
 * overview, so every "record it" link built on it returned the operator to the
 * page they were on — fourteen of them, on every resident. The resident record
 * must never link to itself as if that were where a fact gets recorded.
 */
const ROOT = path.resolve(__dirname, "../../..");
const RESIDENT_RECORD_SOURCES = [
  "src/components/residents/ResidentDetailOverviewClient.tsx",
  "src/components/residents/AdminResidentDetailShell.tsx",
  "src/components/residents/ResidentRecordFactDialog.tsx",
  "src/components/residents/ResidentHeaderActions.tsx",
];

describe("the resident record never links to itself as an editor", () => {
  it.each(RESIDENT_RECORD_SOURCES)("%s builds no /admin/v2/residents link", (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    // A string or template literal starting the path — comments may name it.
    expect(source).not.toMatch(/[`"']\/admin\/v2\/residents/);
    expect(source).not.toMatch(/profileEditHref/);
  });

  it("the v2 resident route is still only a re-export of the overview (so a link to it is a self-link)", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/(admin)/admin/v2/residents/[id]/page.tsx"), "utf8");
    // If this ever becomes a real editor, this probe and COL-597's rule should be revisited together.
    expect(route).toMatch(/export \{ default \} from "\.\.\/\.\.\/\.\.\/residents\/\[id\]\/page"/);
  });
});
