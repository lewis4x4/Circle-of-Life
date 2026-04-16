/**
 * User Management Page — /admin/settings/users
 * Lists all users with filtering, provides CRUD actions.
 */

"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { UserListView } from "@/components/admin/users/UserListView";
import { UserCreateDialog } from "@/components/admin/users/UserCreateDialog";
import { UserEditSheet } from "@/components/admin/users/UserEditSheet";
import { PermissionGuard } from "@/components/admin/users/PermissionGuard";
import { ArrowLeft, Users, UserPlus } from "lucide-react";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";

export default function UserManagementPage() {
  const supabase = createClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [homeHref, setHomeHref] = useState("/admin");

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setHomeHref("/admin");
        return;
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("app_role")
        .eq("id", user.id)
        .maybeSingle();
      setHomeHref(profile?.app_role ? getDashboardRouteForRole(profile.app_role) : "/admin");
    })();
  }, [supabase]);

  const handleUserCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setShowCreateDialog(false);
  }, []);

  const handleUserUpdated = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setSelectedUserId(null);
  }, []);

  const handleDeactivate = useCallback(async (userId: string) => {
    if (!confirm("Deactivate this user? They will lose access immediately.")) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Deactivated via admin UI" }),
      });
      if (!res.ok) throw new Error("Failed to deactivate");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to deactivate user");
    }
  }, []);

  const handleReactivate = useCallback(async (userId: string) => {
    if (!confirm("Reactivate this user?")) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}/reactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reactivated via admin UI" }),
      });
      if (!res.ok) throw new Error("Failed to reactivate");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reactivate user");
    }
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-end">
        <Link
          href={homeHref}
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
      </div>
      <PermissionGuard feature="user_management" level="view" fallback={<AccessDenied />}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-teal-500" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
              <p className="text-sm text-muted-foreground">
                Create, edit, and manage user accounts and facility access
              </p>
            </div>
          </div>
          <PermissionGuard feature="user_management" level="edit">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </button>
          </PermissionGuard>
        </div>

        {/* User List */}
        <UserListView
          key={refreshKey}
          onSelectUser={setSelectedUserId}
          onDeactivate={handleDeactivate}
          onReactivate={handleReactivate}
        />

        {/* Create Dialog */}
        <UserCreateDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onCreated={handleUserCreated}
        />

        {/* Edit Sheet */}
        {selectedUserId && (
          <UserEditSheet
            userId={selectedUserId}
            onClose={handleUserUpdated}
          />
        )}
      </PermissionGuard>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
      <div className="text-center">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-40" />
        <h2 className="text-lg font-medium">Access Restricted</h2>
        <p className="text-sm mt-1">You need admin permissions to manage users.</p>
      </div>
    </div>
  );
}
