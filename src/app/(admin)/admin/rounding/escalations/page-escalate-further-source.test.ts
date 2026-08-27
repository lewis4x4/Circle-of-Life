import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("rounding escalations — no dead escalate-further route", () => {
  it("keeps in-page Start review / Resolve / Dismiss and does not link a missing /review page", () => {
    expect(pageSource).toContain('onAction("start_review")');
    expect(pageSource).toContain("Start review");
    expect(pageSource).toContain('onAction("resolve")');
    expect(pageSource).toContain("Resolve");
    expect(pageSource).toContain('onAction("dismiss")');
    expect(pageSource).toContain("Dismiss as duplicate");
    expect(pageSource).not.toContain("Escalate further");
    expect(pageSource).not.toMatch(/escalations\/\$\{row\.id\}\/review/);
  });
});
