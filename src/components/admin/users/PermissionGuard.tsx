/**
 * PermissionGuard — gates children behind a role/permission check.
 * Renders fallback (or nothing) if the user lacks permission.
 */

"use client";

import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/lib/rbac";
import type { ReactNode } from "react";

interface PermissionGuardProps {
  /** Feature to check (e.g. "user_management", "billing") */
  feature: string;
  /** Minimum permission level required. Default: "view" */
  level?: "view" | "edit" | "delete" | "admin";
  /** Fallback to show when permission is denied. Default: null (render nothing) */
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGuard({
  feature,
  level = "view",
  fallback = null,
  children,
}: PermissionGuardProps) {
  const { user } = useAuth();
  const role = user?.app_metadata?.app_role as string | undefined;

  if (!role || !hasPermission(role, feature, level)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
