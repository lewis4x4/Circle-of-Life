/**
 * Family Portal messages are one-way (Haven → family). Families must not be able
 * to insert via RLS; staff administrators and assistants may post staff notes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { postStaffMessage } from "@/lib/admin/family-messages-data";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/309_family_portal_messages_one_way.sql",
);
const familyDataPath = path.join(repoRoot, "src/lib/family/family-messages-data.ts");
const familyPagePath = path.join(repoRoot, "src/app/(family)/family/messages/page.tsx");

describe("family portal messages one-way policy", () => {
  it("migration drops family INSERT policy and restricts staff INSERT roles", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/DROP POLICY IF EXISTS family_send_messages_for_linked_residents/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS staff_send_family_portal_messages/i);
    expect(sql).toMatch(/author_kind = 'staff'/);
    expect(sql).toMatch(/facility_admin/);
    expect(sql).toMatch(/admin_assistant/);
    expect(sql).not.toMatch(/'family'/);
    expect(sql).not.toMatch(/'nurse'/);
    expect(sql).not.toMatch(/'caregiver'/);
  });

  it("family data layer does not export a family post helper", () => {
    const source = fs.readFileSync(familyDataPath, "utf8");
    expect(source).not.toMatch(/export async function postFamilyMessage/);
    expect(source).toMatch(/\.eq\("author_kind", "staff"\)/);
  });

  it("family messages page has no composer or send affordance", () => {
    const source = fs.readFileSync(familyPagePath, "utf8");
    expect(source).not.toMatch(/postFamilyMessage/);
    expect(source).not.toMatch(/Send/);
    expect(source).not.toMatch(/textarea/);
    expect(source).not.toMatch(/ask questions/i);
    expect(source).toMatch(/does not support replies/i);
  });

  it("staff post helper remains available for one-way notes", () => {
    expect(typeof postStaffMessage).toBe("function");
  });
});

describe("fetchFamilyMessagesForResident staff-only scope", () => {
  it("queries family_portal_messages with author_kind staff filter", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data: [], error: null });
          }
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return proxy;
          };
        },
      },
    );

    const supabase = {
      from: () => proxy,
    } as never;

    const { fetchFamilyMessagesForResident } = await import(
      "@/lib/family/family-messages-data"
    );
    const result = await fetchFamilyMessagesForResident(supabase, "resident-1");
    expect(result.ok).toBe(true);

    expect(
      calls.some(
        (c) =>
          c.method === "eq" &&
          c.args[0] === "author_kind" &&
          c.args[1] === "staff",
      ),
    ).toBe(true);
  });
});
