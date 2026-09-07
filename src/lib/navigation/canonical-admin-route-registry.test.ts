import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_ADMIN_ROUTE_REPAIRS,
  resolveCanonicalAdminRoute,
} from "./canonical-admin-route-registry";

describe("canonical admin route repairs", () => {
  it("keeps every repaired canonical destination backed by one page module", () => {
    for (const route of CANONICAL_ADMIN_ROUTE_REPAIRS) {
      expect(existsSync(path.resolve(process.cwd(), route.pageModulePath)), route.canonicalPathname).toBe(true);
    }
  });

  it("maps every legacy workflow path to its canonical destination", () => {
    expect(resolveCanonicalAdminRoute("/finance/forecast")).toBe("/admin/finance/forecast");
    expect(resolveCanonicalAdminRoute("/finance/close")).toBe("/admin/finance/close");
    expect(resolveCanonicalAdminRoute("/finance/trust")).toBe("/admin/finance/trust");
    expect(resolveCanonicalAdminRoute("/reports/history/run-42")).toBe("/admin/reports/history/run-42");
    expect(resolveCanonicalAdminRoute("/training/inservice/new")).toBe("/admin/training/inservice/new");
    expect(resolveCanonicalAdminRoute("/transportation/requests/new")).toBe("/admin/transportation/requests/new");
    expect(resolveCanonicalAdminRoute("/transportation/requests/request-7")).toBe("/admin/transportation/requests/request-7");
  });
});
