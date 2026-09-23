import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-627 item 7 — the app-code half of the retired-role guard.
 *
 * Migration 468 folded nurse and caregiver into med_tech, and dietary and dietary_aide
 * into cook. Migration 469 renamed marketing to recruiter. `review_role_consolidation.sql`
 * stops a migration from granting a retired role again; this stops app code from doing it.
 *
 * The same words still appear legitimately: staff positions (`dietary_aide`), the
 * `/caregiver` floor-app shell name, stand-up section keys ("marketing"), clinical copy,
 * and display labels kept for history rows. Those are the counts below, file by file.
 * A NEW file with one of these literals, or a higher count in a listed file, fails. When
 * one is added on purpose, add it here in the same change and say why in review. When
 * one is removed, lower the count (the test tells you to).
 */
const RETIRED = /["'](nurse|caregiver|dietary|dietary_aide|marketing)["']/g;

const BASELINE: Record<string, number> = {
  "src/app/(admin)/admin/compliance/policies/new/page.tsx": 1,
  "src/app/(admin)/admin/feedback/page.tsx": 1,
  "src/app/(admin)/admin/operations/work/_components/dietary-service-entry.tsx": 1,
  "src/app/(admin)/admin/settings/notifications/page.tsx": 1,
  "src/app/(admin)/staff/[id]/page.tsx": 5,
  "src/app/(admin)/staff/new/page.tsx": 1,
  "src/app/(caregiver)/caregiver/resident/[id]/timeline/page.tsx": 1,
  "src/components/care-events/timeline/ResidentTimeline.tsx": 1,
  "src/components/feedback/PilotFeedbackLauncher.tsx": 2,
  "src/components/layout/AdminShell.tsx": 1,
  "src/components/layout/CaregiverShell.tsx": 1,
  "src/components/staff/AdminStaffPageClient.tsx": 2,
  "src/lib/admin/facilities/facility-required-staff-roles.ts": 3,
  "src/lib/auth/app-role.ts": 2,
  "src/lib/auth/dashboard-routing.ts": 7,
  "src/lib/care-events/admin-copy.ts": 1,
  "src/lib/care-events/receipt-copy.ts": 1,
  "src/lib/care-events/timeline.ts": 1,
  "src/lib/care-plans/care-plan-print-packet.ts": 1,
  "src/lib/care-plans/draft-from-form-1823.ts": 1,
  "src/lib/care-plans/form-1823-alignment.ts": 2,
  "src/lib/executive/standup.ts": 4,
  "src/lib/navigation/pillars.ts": 1,
  "src/lib/navigation/staff-launch-hidden.ts": 1,
  "src/lib/operations/dietary-service-source-map.ts": 4,
  "src/lib/resident-intake/fact-registry.ts": 19,
  "src/lib/search-tools.ts": 2,
  "src/lib/staff/load-staff.ts": 5,
  "src/lib/stand-up/model.ts": 4,
  "src/types/staff.ts": 2,
};

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("retired app roles do not come back into app code (COL-615 / COL-627)", () => {
  const counts = new Map<string, number>();
  for (const file of walk(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (rel === "src/types/database.ts") continue; // the Postgres enum still has the values
    const n = (fs.readFileSync(file, "utf8").match(RETIRED) ?? []).length;
    if (n > 0) counts.set(rel, n);
  }

  it("no file names a retired role more often than the reviewed baseline", () => {
    const over = [...counts].filter(([file, n]) => n > (BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (baseline ${BASELINE[file] ?? 0}) — use med_tech / cook / recruiter`);
    expect(over).toEqual([]);
  });

  it("the baseline does not outlive the code it describes", () => {
    const stale = Object.entries(BASELINE).filter(([file, n]) => (counts.get(file) ?? 0) < n)
      .map(([file, n]) => `${file}: now ${counts.get(file) ?? 0}, baseline ${n} — lower it`);
    expect(stale).toEqual([]);
  });
});
