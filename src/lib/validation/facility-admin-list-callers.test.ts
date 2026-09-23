import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listFacilitiesQuerySchema } from "@/lib/validation/facility-admin";

/**
 * COL-647: /admin/operations/templates asked GET /api/admin/facilities for
 * page_size=100 while the route validates page_size <= 50, so every load was a 400.
 * Every client caller of the paginated list must ask for a page size the route accepts.
 */

const SRC = path.resolve(__dirname, "../..");
const LIST_URL = /\/api\/admin\/facilities\?([^"'`\s]*)/g;
const PAGE_SIZE_ARG = /\b(?:useFacilities|fetchFacilitiesList|facilitiesListQueryKey)\(\{[^}]*\bpageSize:\s*(\d+)/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(SRC, "app", "api")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function pageSizeAccepted(pageSize: string): boolean {
  return listFacilitiesQuerySchema.safeParse({ page_size: pageSize }).success;
}

describe("client callers of GET /api/admin/facilities", () => {
  const files = sourceFiles(SRC).map((file) => ({
    file: path.relative(SRC, file),
    text: fs.readFileSync(file, "utf8"),
  }));

  it("only request page sizes the route validator accepts", () => {
    const rejected: string[] = [];
    for (const { file, text } of files) {
      for (const match of text.matchAll(LIST_URL)) {
        const size = /(?:^|&)page_size=(\d+)/.exec(match[1])?.[1];
        if (size && !pageSizeAccepted(size)) rejected.push(`${file}: page_size=${size}`);
      }
      for (const match of text.matchAll(PAGE_SIZE_ARG)) {
        if (!pageSizeAccepted(match[1])) rejected.push(`${file}: pageSize ${match[1]}`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it("keeps the shared list helpers' default page size within the validator", () => {
    for (const helper of ["hooks/useFacilities.ts", "lib/admin/facilities/fetch-facilities-list.ts"]) {
      const text = files.find((f) => f.file === helper)?.text ?? "";
      const defaults = [...text.matchAll(/pageSize = (\d+)/g)].map((m) => m[1]);
      expect(defaults.length, helper).toBeGreaterThan(0);
      for (const size of defaults) expect(pageSizeAccepted(size), `${helper} default ${size}`).toBe(true);
    }
  });

  it("rejects the page size the operations templates page used to send", () => {
    expect(pageSizeAccepted("100")).toBe(false);
  });
});
