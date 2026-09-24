import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

// COL-707 ruling 5 (Brian, 2026-09-23): Executive Reports is retired; /admin/reports is canonical.
describe("Executive Reports retired", () => {
  it("308s /admin/executive/reports to /admin/reports", () => {
    expect(LEGACY_REDIRECTS).toContainEqual({ source: "/admin/executive/reports", destination: "/admin/reports", permanent: true });
  });

  it("has no page under either executive tree", () => {
    const app = path.resolve(__dirname, "../../app/(admin)");
    for (const dir of ["executive/reports", "admin/executive/reports"]) {
      expect(fs.existsSync(path.join(app, dir, "page.tsx"))).toBe(false);
    }
  });

  it("nothing in src links to it", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !full.endsWith("legacy-redirects.ts")) {
          if (/["'`]\/admin\/executive\/reports["'`/]/.test(fs.readFileSync(full, "utf8"))) hits.push(full);
        }
      }
    };
    walk(path.resolve(__dirname, "../.."));
    expect(hits).toEqual([]);
  });
});
