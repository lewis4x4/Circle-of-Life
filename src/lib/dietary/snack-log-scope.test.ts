import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SNACK_PASS_HELPER_COPY, SNACK_PASS_SECTION_ID } from "@/components/dietary/AdminDietaryPageClient";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const dietaryBootstrapSource = readSource("src/lib/dietary/load-dietary-hub-bootstrap.ts");
const dietaryClientSource = readSource("src/components/dietary/AdminDietaryPageClient.tsx");
const pillarsSource = readSource("src/lib/navigation/pillars.ts");
const migrationSource = readSource("supabase/migrations/311_snack_logs_time_and_passer_only.sql");

const OUT_OF_SCOPE_SNACK_FIELDS = [
  "snack_description",
  "residents_offered_count",
  "residents_accepted_count",
] as const;

describe("snack log scope (COL time + passer only)", () => {
  it("drops out-of-scope snack columns in migration without row rewrite", () => {
    for (const column of OUT_OF_SCOPE_SNACK_FIELDS) {
      expect(migrationSource).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
    expect(migrationSource).toContain("DROP COLUMN IF EXISTS notes");
    expect(migrationSource).not.toMatch(/UPDATE\s+public\.snack_logs/i);
    expect(migrationSource).not.toMatch(/SELECT\s+.*\s+FROM\s+public\.snack_logs/i);
  });

  it("loads snack logs with time and passer only", () => {
    for (const field of OUT_OF_SCOPE_SNACK_FIELDS) {
      expect(dietaryBootstrapSource).not.toContain(field);
    }
    expect(dietaryBootstrapSource).toContain("passed_by_user_id");
    expect(dietaryBootstrapSource).toContain(
      '"id, snack_at, passed_by_user_id, created_at, user_profiles!passed_by_user_id(full_name)"',
    );
  });

  it("keeps staff UI and write path to snack time + passer only", () => {
    for (const field of OUT_OF_SCOPE_SNACK_FIELDS) {
      expect(dietaryClientSource).not.toContain(field);
    }
    expect(dietaryClientSource).not.toContain("Snack description");
    expect(dietaryClientSource).not.toContain('placeholder="Offered"');
    expect(dietaryClientSource).not.toContain('placeholder="Accepted"');
    expect(dietaryClientSource).not.toContain("Snack notes");
    expect(dietaryClientSource).not.toContain("Meal / snack log");
    expect(dietaryClientSource).toContain("Log snack pass");
    expect(dietaryClientSource).toContain("Snack passed —");
    expect(dietaryClientSource).toMatch(/snack_at:\s*snackAt\.toISOString\(\)/);
    expect(dietaryClientSource).toMatch(/passed_by_user_id:\s*user\.id/);
  });

  it("surfaces snack pass as the primary dietary landing action", () => {
    expect(SNACK_PASS_SECTION_ID).toBe("snack-pass");
    expect(SNACK_PASS_HELPER_COPY).toMatch(/who passed it/i);
    expect(SNACK_PASS_HELPER_COPY).toMatch(/time and passer/i);
    expect(dietaryClientSource).toContain(`id={SNACK_PASS_SECTION_ID}`);
    expect(dietaryClientSource).toContain("No snack passes logged yet for this facility.");
    expect(dietaryClientSource.indexOf("Snack pass")).toBeLessThan(
      dietaryClientSource.indexOf("Attention Queue"),
    );
    expect(pillarsSource).toContain('href: "/admin/dietary#snack-pass"');
  });

  it("uses a calm empty snack log notice instead of an error state", () => {
    expect(dietaryClientSource).toContain("No snack passes logged yet for this facility.");
    expect(dietaryClientSource).not.toMatch(/No snack passes.*border-red/i);
    expect(dietaryClientSource).not.toMatch(/No snack passes.*text-red/i);
  });
});
