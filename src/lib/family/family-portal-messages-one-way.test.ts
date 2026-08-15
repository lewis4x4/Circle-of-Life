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
const staffPagePath = path.join(repoRoot, "src/app/(admin)/admin/family-messages/page.tsx");
const staffBulletinSectionPath = path.join(
  repoRoot,
  "src/components/family-portal/StaffFamilyBulletinSection.tsx",
);
const familyFeedPath = path.join(repoRoot, "src/lib/family/family-feed.ts");
const familyHomePath = path.join(repoRoot, "src/app/(family)/family/page.tsx");
const familyHomeBulletinPath = path.join(
  repoRoot,
  "src/components/family-portal/FamilyHomeBulletinBar.tsx",
);
const familyPortalCopyPath = path.join(repoRoot, "src/lib/family/family-portal-copy.ts");
const staffComposerPath = path.join(
  repoRoot,
  "src/components/family-portal/StaffFamilyNoteComposer.tsx",
);

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
    expect(source).not.toMatch(/T8InboxThreaded/);
    expect(source).not.toMatch(/inbox queue/i);
    expect(source).toMatch(/does not support replies/i);
    expect(source).toMatch(/FamilyPortalUpdateLog/);
  });

  it("staff page presents bulletin posting, not a two-way inbox", () => {
    const source = fs.readFileSync(staffPagePath, "utf8");
    expect(source).toMatch(/postStaffMessage/);
    expect(source).toMatch(/StaffFamilyBulletinSection/);
    expect(source).toMatch(/FamilyPortalUpdateLog/);
    expect(source).toMatch(/FAMILY_BULLETIN_EMPTY_TITLE/);
    expect(source).not.toMatch(/Start the conversation/i);
    expect(source).not.toMatch(/family replied/i);
    expect(source).not.toMatch(/Inbox Zero/i);
    expect(source).not.toMatch(/Resident threads/i);
    expect(source).not.toMatch(/<Send /);
    expect(source).not.toMatch(/justify-end/);
    expect(source).not.toMatch(/StaffFamilyNoteComposer/);
  });

  it("bulletin section surfaces one-way helper and resident picker", () => {
    const source = fs.readFileSync(staffBulletinSectionPath, "utf8");
    expect(source).toMatch(/FAMILY_BULLETIN_ONE_WAY_HELPER/);
    expect(source).toMatch(/Post a bulletin note/);
    expect(source).toMatch(/Last posted/);
    expect(source).not.toMatch(/type a reply/i);
    expect(source).not.toMatch(/Send className/);
  });

  it("staff composer uses post-update copy, not reply or send affordances", () => {
    const source = fs.readFileSync(staffComposerPath, "utf8");
    expect(source).toMatch(/Post update/);
    expect(source).toMatch(/Post an update/);
    expect(source).not.toMatch(/type a reply/i);
    expect(source).not.toMatch(/Send className/);
    expect(source).not.toMatch(/lucide-react.*Send/);
  });

  it("staff post helper remains available for one-way notes", () => {
    expect(typeof postStaffMessage).toBe("function");
  });
});

describe("family home feed surfaces staff bulletin notes", () => {
  it("family-feed queries staff-only portal messages for linked residents", () => {
    const source = fs.readFileSync(familyFeedPath, "utf8");
    expect(source).toMatch(/family_portal_messages/);
    expect(source).toMatch(/\.eq\("author_kind", "staff"\)/);
    expect(source).toMatch(/featuredNote/);
  });

  it("family home page leads with the bulletin bar and has no composer", () => {
    const source = fs.readFileSync(familyHomePath, "utf8");
    expect(source).toMatch(/FamilyHomeBulletinBar/);
    expect(source).toMatch(/featuredNote/);
    expect(source).not.toMatch(/postFamilyMessage/);
    expect(source).not.toMatch(/textarea/);
    expect(source).not.toMatch(/Send/);
    expect(source).not.toMatch(/journal is quiet/i);
    expect(source).not.toMatch(/start the conversation/i);
  });

  it("family home bulletin bar uses calm empty copy and one-way helper", () => {
    const bulletinSource = fs.readFileSync(familyHomeBulletinPath, "utf8");
    const copySource = fs.readFileSync(familyPortalCopyPath, "utf8");

    expect(bulletinSource).toMatch(/FAMILY_HOME_BULLETIN_HELPER/);
    expect(bulletinSource).toMatch(/FAMILY_HOME_BULLETIN_EMPTY_TITLE/);
    expect(bulletinSource).toMatch(/Last posted/);
    expect(bulletinSource).not.toMatch(/textarea/);
    expect(bulletinSource).not.toMatch(/type a reply/i);

    expect(copySource).toMatch(/No notes posted yet/);
    expect(copySource).toMatch(/cannot reply in Haven/i);
    expect(copySource).not.toMatch(/start the conversation/i);
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
