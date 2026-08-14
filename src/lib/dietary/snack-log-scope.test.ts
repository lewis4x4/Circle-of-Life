import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const dietaryBootstrapSource = readSource("src/lib/dietary/load-dietary-hub-bootstrap.ts");
const dietaryClientSource = readSource("src/components/dietary/AdminDietaryPageClient.tsx");
const migrationSource = readSource("supabase/migrations/310_snack_logs_time_and_passer_only.sql");

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
    expect(dietaryClientSource).toContain("Log snack passed");
    expect(dietaryClientSource).toContain("Snack passed —");
    expect(dietaryClientSource).toMatch(/snack_at:\s*snackAt\.toISOString\(\)/);
  });
});
