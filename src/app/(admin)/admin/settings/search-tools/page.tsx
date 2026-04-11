/**
 * Search Tool Dashboard — /admin/settings/search-tools
 * RBAC matrix + real-time activity feed for search tool access.
 * Restricted to facility_admin and above.
 */

"use client";

import { SearchToolDashboard } from "@/components/admin/settings/SearchToolDashboard";
import { PermissionGuard } from "@/components/admin/users/PermissionGuard";

export default function SearchToolsPage() {
  return (
    <PermissionGuard
      feature="reports"
      level="view"
      fallback={
        <div className="flex h-[60vh] items-center justify-center text-sm text-slate-400">
          You don&apos;t have permission to view this page.
        </div>
      }
    >
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <SearchToolDashboard />
      </div>
    </PermissionGuard>
  );
}
