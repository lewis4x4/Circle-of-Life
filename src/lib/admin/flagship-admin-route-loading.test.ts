import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const flagshipLoadingPaths = [
  "src/app/(admin)/admin/staffing/loading.tsx",
  "src/app/(admin)/admin/dietary/loading.tsx",
  "src/app/(admin)/admin/billing/loading.tsx",
  "src/app/(admin)/admin/facilities/[facilityId]/loading.tsx",
  "src/app/(admin)/admin/family-messages/loading.tsx",
  "src/app/(admin)/admin/residents/loading.tsx",
  "src/app/(admin)/residents/loading.tsx",
] as const;

describe("flagship admin route named loading", () => {
  it.each(flagshipLoadingPaths)("uses NamedAdminRouteLoading in %s", (relativePath) => {
    const source = readSource(relativePath);
    expect(source).toMatch(/NamedAdminRouteLoading/);
    expect(source).not.toMatch(/@\/components\/layout\/admin-route-loading/);
  });

  it("maps each flagship loading boundary to route-specific copy", () => {
    expect(readSource(flagshipLoadingPaths[0])).toContain("ADMIN_STAFFING_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[1])).toContain("ADMIN_DIETARY_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[2])).toContain("ADMIN_BILLING_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[3])).toContain("ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[4])).toContain("ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[5])).toContain("ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE");
    expect(readSource(flagshipLoadingPaths[6])).toContain("ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE");
  });

  it("names residents roster Suspense and client refetch gaps instead of silent skeletons", () => {
    const pageSource = readSource("src/app/(admin)/residents/page.tsx");
    expect(pageSource).toMatch(/NamedAdminRouteLoading/);
    expect(pageSource).toMatch(/ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE/);
    expect(pageSource).not.toMatch(/@\/components\/layout\/admin-route-loading/);

    const clientSource = readSource("src/components/residents/AdminResidentsPageClient.tsx");
    expect(clientSource).toMatch(/NamedAdminRouteLoading/);
    expect(clientSource).toMatch(/ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE/);
    expect(clientSource).not.toMatch(/AdminTableLoadingState/);
  });

  it("names staffing client refetch gaps instead of silent skeletons", () => {
    const source = readSource("src/components/staffing/AdminStaffingConsolePageClient.tsx");
    expect(source).toMatch(/NamedAdminRouteLoading/);
    expect(source).toMatch(/ADMIN_STAFFING_ROUTE_LOADING_MESSAGE/);
    expect(source).not.toMatch(/<Skeleton className="h-\[140px\]/);
  });

  it("names facility overview client hydration gaps instead of a spinner-only shell", () => {
    const source = readSource("src/app/(admin)/admin/facilities/[facilityId]/page.tsx");
    expect(source).toMatch(/NamedAdminRouteLoading/);
    expect(source).toMatch(/ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE/);
    expect(source).not.toMatch(/Loader2 className="h-8 w-8 animate-spin text-primary"/);
    expect(source).toMatch(/Suspense fallback={<NamedAdminRouteLoading message={ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE} \/>}/);
  });

  it("names family notes client fetch gaps instead of a spinner-only shell", () => {
    const source = readSource("src/app/(admin)/admin/family-messages/page.tsx");
    expect(source).toMatch(/NamedAdminRouteLoading/);
    expect(source).toMatch(/ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE/);
    expect(source).not.toMatch(/Loader2 className="h-8 w-8 animate-spin text-primary-500"/);
    expect(source).toMatch(/FAMILY_BULLETIN_PAGE_TITLE/);
    expect(source).toMatch(/FAMILY_BULLETIN_PAGE_DESCRIPTION/);
    expect(source).not.toMatch(/Unread messages/i);
    expect(source).not.toMatch(/Needs response/i);
  });
});
