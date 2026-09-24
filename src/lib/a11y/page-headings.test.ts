import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * COL-658: these pages had no h1 (an h2 or nothing) or two. Each file named
 * here renders the page's title; it must be an h1 and there must be one per
 * rendered state, not an h2 standing in for it.
 */
const PAGE_TITLE_SOURCES = [
  "src/app/(admin)/admin/briefing/page.tsx",
  "src/app/(admin)/executive/alerts/page.tsx",
  "src/components/incidents/AdminIncidentsPageClient.tsx",
  "src/app/(admin)/admin/infection-control/page.tsx",
  "src/app/(admin)/admin/compliance/rules/page.tsx",
  "src/app/(admin)/reputation/page.tsx",
  "src/components/compliance/SurveyReadinessBinder.tsx",
  "src/app/(admin)/admin/approvals/page.tsx",
  "src/app/(admin)/admin/calendar/page.tsx",
  "src/app/(admin)/admin/contacts/page.tsx",
  "src/app/(admin)/admin/drive-cutover/page.tsx",
  "src/app/(admin)/admin/drive-import/page.tsx",
  "src/app/(admin)/admin/files/page.tsx",
  "src/app/(admin)/admin/front-desk/page.tsx",
  "src/app/(admin)/admin/handoff/page.tsx",
  "src/app/(admin)/admin/kanban/page.tsx",
  "src/app/(admin)/admin/mentions/page.tsx",
  "src/app/(admin)/admin/workspace/page.tsx",
  "src/components/care-events/print/TaxonomyPacketPageClient.tsx",
  "src/app/(family)/family/messages/page.tsx",
  "src/app/(med-tech)/med-tech/page.tsx",
  "src/app/(admin)/admin/acknowledgments/page.tsx",
  "src/app/(admin)/admin/acknowledgments/my/page.tsx",
  "src/app/(admin)/admin/forms/page.tsx",
  "src/app/(admin)/admin/forms/submit/page.tsx",
  "src/app/(admin)/admin/meetings/page.tsx",
  "src/app/(admin)/admin/meetings/new/page.tsx",
  "src/components/schedules/AdminSchedulesPageClient.tsx",
  "src/app/(admin)/admin/shift-swaps/page.tsx",
  "src/components/staffing/AdminStaffingConsolePageClient.tsx",
  "src/app/(admin)/admin/teams/page.tsx",
  "src/app/(admin)/time-records/page.tsx",
  "src/app/(admin)/training/page.tsx",
  "src/app/(admin)/certifications/page.tsx",
  "src/components/facility-checks/StaffCheckClient.tsx",
  "src/components/facility-checks/BoardCheckClient.tsx",
] as const;

describe("page titles are h1s (COL-658)", () => {
  it.each(PAGE_TITLE_SOURCES)("%s renders an h1", (file) => {
    // The design-system PageHeader renders the title as the page's h1 (COL-656).
    expect(readFileSync(file, "utf8")).toMatch(/<h1\b|<PageHeader\b/);
  });

  it.each(["src/app/(admin)/admin/staff/staff-check/page.tsx", "src/app/(admin)/admin/residents/board-check/page.tsx"])(
    "%s leaves the one h1 to its client (no duplicate)",
    (file) => {
      const source = readFileSync(file, "utf8");
      // One h1 in the access-denied branch only.
      expect(source.match(/<h1\b/g)?.length ?? 0).toBe(1);
    },
  );

  it("keeps the caregiver facility picker out of the shell h1", () => {
    const source = readFileSync("src/components/layout/CaregiverShell.tsx", "utf8");
    const h1 = source.slice(source.indexOf("<h1"), source.indexOf("</h1>"));
    expect(h1).not.toContain("WorkingFacilitySelector");
  });
});
