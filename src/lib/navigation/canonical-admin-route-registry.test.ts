import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(path.resolve(process.cwd(), "next.config.ts"), "utf8");

const CANONICAL_ADMIN_ROUTE_REPAIRS = [
  ["/finance/forecast", "/admin/finance/forecast", "src/app/(admin)/finance/forecast/page.tsx"],
  ["/finance/close", "/admin/finance/close", "src/app/(admin)/finance/close/page.tsx"],
  ["/finance/trust", "/admin/finance/trust", "src/app/(admin)/finance/trust/page.tsx"],
  ["/reports/history/:id", "/admin/reports/history/:id", "src/app/(admin)/reports/history/[id]/page.tsx"],
  ["/training/inservice/new", "/admin/training/inservice/new", "src/app/(admin)/training/inservice/new/page.tsx"],
  ["/transportation/requests/new", "/admin/transportation/requests/new", "src/app/(admin)/transportation/requests/new/page.tsx"],
  ["/transportation/requests/:id", "/admin/transportation/requests/:id", "src/app/(admin)/transportation/requests/[id]/page.tsx"],
] as const;

describe("canonical admin route repairs", () => {
  it("keeps every repaired canonical destination backed by one page module", () => {
    for (const [, canonicalPathname, pageModulePath] of CANONICAL_ADMIN_ROUTE_REPAIRS) {
      expect(existsSync(path.resolve(process.cwd(), pageModulePath)), canonicalPathname).toBe(true);
    }
  });

  it("keeps the actual redirect configuration for every legacy route segment", () => {
    for (const [legacyPathname, canonicalPathname] of CANONICAL_ADMIN_ROUTE_REPAIRS) {
      const segment = legacyPathname.split("/")[1];
      expect(nextConfigSource).toContain(`"${segment}"`);
      expect(canonicalPathname).toBe(`/admin${legacyPathname}`);
    }
  });
});
