import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL,
  formatFamilyBulletinDashboardPreview,
} from "@/lib/admin/family-bulletin-dashboard-copy";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const assistantBriefPath = "src/lib/admin-assistant/dashboard-brief.ts";
const coordinatorBriefPath = "src/lib/coordinator/dashboard-brief.ts";
const assistantPagePath = "src/components/admin-assistant/AssistantDashboardPageClient.tsx";
const coordinatorPagePath = "src/components/coordinator/CoordinatorDashboardPageClient.tsx";
const assistantServerPagePath = "src/app/(admin)/admin/assistant-dashboard/page.tsx";
const coordinatorServerPagePath = "src/app/(admin)/admin/coordinator-dashboard/page.tsx";
const assistantLoadingPath = "src/app/(admin)/admin/assistant-dashboard/loading.tsx";
const coordinatorLoadingPath = "src/app/(admin)/admin/coordinator-dashboard/loading.tsx";
const roleHomeGatePath = "src/components/auth/role-home-page-gate.tsx";
const routingPath = "src/lib/auth/dashboard-routing.ts";

const forbiddenInboxCopy = [
  "Needs response",
  "Unread messages",
  "All read",
  "No unread messages",
  "is_read",
];

describe("assistant and coordinator dashboard family bulletin briefs", () => {
  it("does not query the removed family_messages table", () => {
    for (const relativePath of [assistantBriefPath, coordinatorBriefPath]) {
      const source = readSource(relativePath);
      expect(source).not.toMatch(/family_messages/);
      expect(source).toMatch(/family_portal_messages/);
      expect(source).toMatch(/author_kind/);
      expect(source).toMatch(/"staff"/);
    }
  });

  it("counts outbound staff bulletin notes only", () => {
    const assistantSource = readSource(assistantBriefPath);
    expect(assistantSource).toMatch(/staffBulletinNotes/);
    expect(assistantSource).not.toMatch(/unreadMessages/);
    expect(assistantSource).not.toMatch(/recentMessages/);
    expect(assistantSource).toMatch(/recentBulletinNotes/);

    const coordinatorSource = readSource(coordinatorBriefPath);
    expect(coordinatorSource).toMatch(/staffBulletinNotes/);
    expect(coordinatorSource).not.toMatch(/unreadFamilyMessages/);
  });
});

describe("assistant and coordinator dashboard bulletin tile copy", () => {
  it("does not frame family notes as an unread inbox on landing tiles", () => {
    for (const relativePath of [assistantPagePath, coordinatorPagePath]) {
      const source = readSource(relativePath);
      for (const phrase of forbiddenInboxCopy) {
        expect(source).not.toContain(phrase);
      }
      expect(source).toMatch(/FAMILY_BULLETIN_DASHBOARD_TILE_TITLE/);
      expect(source).toMatch(/FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL/);
      expect(source).toMatch(/FAMILY_BULLETIN_ONE_WAY_HELPER/);
    }
  });

  it("names the empty bulletin state instead of implying an empty inbox", () => {
    expect(FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL).toMatch(/No bulletin notes posted yet/i);

    const assistantSource = readSource(assistantPagePath);
    expect(assistantSource).toMatch(/FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_TITLE/);
    expect(assistantSource).toMatch(/FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_DESCRIPTION/);
  });
});

describe("assistant and coordinator dashboard named loading", () => {
  it("shows named loading copy instead of a silent skeleton-only gate", () => {
    const assistantSource = readSource(assistantPagePath);
    expect(assistantSource).toMatch(/ADMIN_ASSISTANT_DASHBOARD_LOADING_HEADLINE/);
    expect(assistantSource).toMatch(/formatAdminAssistantDashboardKpiValue/);
    expect(assistantSource).not.toMatch(/if \(isLoading\) return <LoadingSkeleton/);

    const coordinatorSource = readSource(coordinatorPagePath);
    expect(coordinatorSource).toMatch(/COORDINATOR_DASHBOARD_LOADING_HEADLINE/);
    expect(coordinatorSource).toMatch(/formatCoordinatorDashboardKpiValue/);
    expect(coordinatorSource).not.toMatch(/if \(isLoading\) return <LoadingSkeleton/);
  });

  it("server pages prefetch the brief for first paint", () => {
    for (const relativePath of [assistantServerPagePath, coordinatorServerPagePath]) {
      const source = readSource(relativePath);
      expect(source).toMatch(/fetchAdminAssistantDashboardBrief|fetchCoordinatorDashboardBrief/);
      expect(source).toMatch(/initialBrief/);
      expect(source).toMatch(/createClient\(\)/);
    }
  });

  it("does not leave wrong-role visitors on a silent skeleton before redirect", () => {
    for (const relativePath of [assistantServerPagePath, coordinatorServerPagePath]) {
      const source = readSource(relativePath);
      expect(source).toMatch(/RoleHomePageGate/);
      expect(source).toMatch(/RoleHomeRouteLoading/);
      expect(source).toMatch(/ROLE_HOME_CHECKING_MESSAGE/);
      expect(source).not.toMatch(/AdminRouteLoading/);
      expect(source).not.toMatch(/\bredirect\s*\(/);
      expect(source.indexOf("<RoleHomePageGate")).toBeLessThan(source.indexOf("<Suspense"));
    }

    for (const relativePath of [assistantLoadingPath, coordinatorLoadingPath]) {
      const source = readSource(relativePath);
      expect(source).toMatch(/RoleHomeRouteLoading/);
      expect(source).toMatch(/ROLE_HOME_CHECKING_MESSAGE/);
    }

    const adminLoadingSource = readSource("src/app/(admin)/admin/loading.tsx");
    expect(adminLoadingSource).toMatch(/admin-role-route-loading/);

    const gateSource = readSource(roleHomeGatePath);
    expect(gateSource).toMatch(/formatRoleHomeBounceMessage/);
    expect(gateSource).toMatch(/router\.replace/);
    expect(gateSource).not.toMatch(/admin-route-loading/);
  });
});

describe("role dashboard routing family bulletin lanes", () => {
  it("labels family work as bulletin posting, not a messages inbox", () => {
    const routingSource = readSource(routingPath);
    expect(routingSource).not.toMatch(/family_messages/);
    expect(routingSource).toMatch(/family_bulletin/);

    expect(getRoleDashboardConfig("admin_assistant").primaryTaskLanes).toContain("family_bulletin");
    expect(getRoleDashboardConfig("coordinator").primaryTaskLanes).toContain("family_bulletin");
  });
});

describe("formatFamilyBulletinDashboardPreview", () => {
  it("names blank bulletin bodies instead of returning an empty preview", () => {
    expect(formatFamilyBulletinDashboardPreview(null)).toBe("No note text posted");
    expect(formatFamilyBulletinDashboardPreview("   ")).toBe("No note text posted");
  });

  it("truncates long bulletin bodies for dashboard rows", () => {
    const longBody = "a".repeat(100);
    const preview = formatFamilyBulletinDashboardPreview(longBody);
    expect(preview).toMatch(/…$/);
    expect(preview.length).toBeLessThan(longBody.length);
  });
});
