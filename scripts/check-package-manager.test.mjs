import { describe, expect, it } from "vitest";

import {
  findForbiddenPackageManagerLockfiles,
  formatFailure,
} from "./check-package-manager.mjs";

describe("package-manager policy", () => {
  it("allows the npm and Deno lockfiles used by Haven", () => {
    expect(
      findForbiddenPackageManagerLockfiles([
        "package-lock.json",
        "deno.lock",
        "supabase/functions/deno.lock",
      ]),
    ).toEqual([]);
  });

  it("rejects tracked pnpm and Yarn lockfiles anywhere in the repository", () => {
    expect(
      findForbiddenPackageManagerLockfiles([
        "package-lock.json",
        "pnpm-lock.yaml",
        "apps/legacy/yarn.lock",
      ]),
    ).toEqual(["apps/legacy/yarn.lock", "pnpm-lock.yaml"]);
  });

  it("names the production outage and the files to remove", () => {
    const message = formatFailure(["pnpm-lock.yaml", "apps/legacy/yarn.lock"]);

    expect(message).toContain("COL-479 38-hour production publish outage");
    expect(message).toContain("pnpm-lock.yaml");
    expect(message).toContain("apps/legacy/yarn.lock");
  });
});
