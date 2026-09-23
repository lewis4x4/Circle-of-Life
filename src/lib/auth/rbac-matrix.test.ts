import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeRbacMatrix, RBAC_MATRIX_ROLES } from "@/lib/auth/rbac-matrix";

/**
 * COL-627: the reviewed route matrix that `npm run homewood:verify-rbac` checks the
 * deployed app against must match what the shell-access functions actually do.
 * If you changed who may open a route on purpose, regenerate the JSON from
 * computeRbacMatrix() and review the diff; if you did not, this caught a regression.
 */
const JSON_PATH = path.resolve(__dirname, "../../../scripts/homewood/rbac-matrix.json");

describe("route role matrix", () => {
  const reviewed = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

  it("covers exactly the current role model", () => {
    expect(reviewed.roles).toEqual([...RBAC_MATRIX_ROLES]);
  });

  it("matches the shell-access functions cell for cell", () => {
    expect(reviewed.matrix).toEqual(computeRbacMatrix());
  });

  it("never sends a signed-in current role to the login screen", () => {
    const denied = Object.entries(computeRbacMatrix()).flatMap(([route, cells]) =>
      Object.entries(cells).filter(([, cell]) => cell.outcome === "deny").map(([role]) => `${role} ${route}`),
    );
    expect(denied).toEqual([]);
  });
});

describe("Med-Tech has no finance, payroll or staff pages (Brian, 2026-09-23)", () => {
  it("sends a med-tech home from each of them and their short aliases", async () => {
    const { shellOutcome } = await import("@/lib/auth/rbac-matrix");
    for (const route of ["/admin/finance", "/finance", "/admin/payroll", "/payroll/runs", "/admin/staff", "/staff/abc"]) {
      expect(shellOutcome("med_tech", route)).toEqual({ outcome: "redirect", location: "/med-tech" });
    }
    expect(shellOutcome("med_tech", "/admin/residents")).toEqual({ outcome: "allow" });
    expect(shellOutcome("facility_admin", "/admin/payroll")).toEqual({ outcome: "allow" });
  });
});
