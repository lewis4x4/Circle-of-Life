import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("operations task defer wall clock", () => {
  it("route delegates the complete defer operation to one transactional RPC", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/admin/operations/tasks/[id]/defer/route.ts"),
      "utf8",
    );
    expect(routeSource).toContain('"defer_operation_task_review"');
    expect(routeSource).not.toContain('.insert({');
    expect(routeSource).not.toContain('.update({');
  });

  it("database command derives shift date and shift from Eastern wall clock", () => {
    const migrationSource = readFileSync(
      join(process.cwd(), "supabase/migrations/326_sys_001_authoritative_actor_state.sql"),
      "utf8",
    );
    expect(migrationSource).toContain("p_deferred_until AT TIME ZONE 'America/New_York'");
    expect(migrationSource).toContain("BETWEEN 15 AND 22 THEN 'evening'");
  });
});
