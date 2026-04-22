/**
 * UserRowActions — inline action buttons for a user row.
 */

"use client";

import { canManageUser } from "@/lib/rbac";
import { useAuth } from "@/hooks/useAuth";

interface UserRowActionsProps {
  user: {
    id: string;
    app_role: string;
    is_active: boolean;
    deleted_at: string | null;
  };
  onSelect: () => void;
  onDeactivate?: (id: string) => void;
  onReactivate?: (id: string) => void;
}

export function UserRowActions({
  user,
  onSelect,
  onDeactivate,
  onReactivate,
}: UserRowActionsProps) {
  const { user: currentUser } = useAuth();
  const currentRole = (currentUser?.app_metadata?.app_role as string) ?? "";
  const canManage = canManageUser(currentRole, user.app_role);
  const isSelf = currentUser?.id === user.id;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onSelect}
        className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        Edit
      </button>
      {canManage && !isSelf && !user.deleted_at && user.is_active && onDeactivate && (
        <button
          onClick={() => onDeactivate(user.id)}
          className="text-xs px-2 py-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
        >
          Deactivate
        </button>
      )}
      {user.deleted_at && onReactivate && (
        <button
          onClick={() => onReactivate(user.id)}
          className="text-xs px-2 py-1 rounded text-emerald-600 hover:bg-emerald-500/10 transition-colors"
        >
          Reactivate
        </button>
      )}
    </div>
  );
}
