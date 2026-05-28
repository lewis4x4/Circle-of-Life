/**
 * Search Tool Dashboard — /admin/settings/search-tools
 * RBAC matrix + real-time activity feed for search tool access.
 * Restricted to facility_admin and above.
 */

"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SearchToolDashboard } from "@/components/admin/settings/SearchToolDashboard";
import { PermissionGuard } from "@/components/admin/users/PermissionGuard";

export default function SearchToolsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex justify-start">
        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      </div>
      <PermissionGuard
        feature="reports"
        level="view"
        fallback={
          <div className="flex h-[60vh] items-center justify-center text-sm text-slate-400">
            You don&apos;t have permission to view this page.
          </div>
        }
      >
        <SearchToolDashboard />
      </PermissionGuard>
    </div>
  );
}
