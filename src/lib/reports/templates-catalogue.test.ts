import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PHASE1_TEMPLATE_SEED } from "./templates";

/**
 * COL-642: the templates list counts PHASE1_TEMPLATE_SEED while the hub and
 * governance count report_templates rows. A slug in the code catalogue with no
 * migration registering it makes the counts disagree and leaves the template
 * unschedulable. Every seed slug must be inserted by some migration.
 */
describe("report template catalogue matches the registered templates", () => {
  it("every code-catalogue slug is inserted into report_templates by a migration", () => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const registering = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .filter((sql) => /INSERT INTO\s+(public\.)?report_templates\b/i.test(sql))
      .join("\n");
    const missing = PHASE1_TEMPLATE_SEED.map((t) => t.slug).filter((slug) => !registering.includes(`'${slug}'`));
    expect(missing).toEqual([]);
  });
});
