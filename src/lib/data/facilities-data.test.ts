import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FACILITIES,
  PUBLIC_AVAILABILITY_COPY,
  TOTAL_COMMUNITIES,
  TOTAL_COUNTIES,
  TOTAL_NETWORK_BEDS,
} from "./facilities-data";

/** Public marketing surfaces that render campus data. */
const PUBLIC_ROOTS = ["src/components/web", "src/app/campuses", "src/app/tour", "src/app/about", "src/app/contact", "src/app/page.tsx", "src/lib/data/facilities-data.ts"];

function publicSources(): Array<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = [];
  const walk = (rel: string) => {
    const full = path.join(process.cwd(), rel);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)) walk(path.join(rel, name));
    } else if (/\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)) {
      out.push({ file: rel, source: readFileSync(full, "utf8") });
    }
  };
  for (const root of PUBLIC_ROOTS) walk(root);
  return out;
}

describe("public campus figures (COL-649)", () => {
  it("derives network totals from the campus list instead of literals", () => {
    expect(TOTAL_NETWORK_BEDS).toBe(FACILITIES.reduce((sum, f) => sum + f.licensedBeds, 0));
    expect(TOTAL_COMMUNITIES).toBe(FACILITIES.length);
    expect(TOTAL_COUNTIES).toBe(new Set(FACILITIES.map((f) => f.address.county)).size);
  });

  it("carries no availability or occupancy figure — nothing public knows who has moved in", () => {
    for (const facility of FACILITIES) {
      expect(facility).not.toHaveProperty("availableBeds");
      expect(facility).not.toHaveProperty("occupancyPct");
    }
    expect(PUBLIC_AVAILABILITY_COPY).not.toMatch(/\d/);
  });

  // Per-campus licensed capacity (e.g. the footer's "License # AL12528 • 36 Beds") is a
  // regulatory fact and may be written out; the network total must be derived.
  it("never states a number of available suites or a literal network bed total on a public page", () => {
    const offenders = publicSources().flatMap(({ file, source }) =>
      source
        .split("\n")
        .map((line, index) => ({ line: index + 1, text: line }))
        .filter(({ text }) => /suites? (available|open)|immediate move-in/i.test(text) || /\b\d{3,}\s+(licensed\s+)?beds\b/i.test(text))
        .map(({ line, text }) => `${file}:${line} ${text.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
