/**
 * UserRowActions — inline action buttons for a user row.
 */

"use client";

import { canActorManageTarget } from "@/lib/rbac";
import { useAuth } from "@/hooks/useAuth";

interface UserRowActionsProps {
  user: {
    id: string;
    email: string;
    app_role: string;
    is_active: boolean;
    deleted_at: string | null;
  };
  onSelect: () => void;
  onDeactivate?: () => void;
  onReactivate?: (id: string) => void;
  onResetPassword?: (user: { id: string; email: string }) => void;
}

export function UserRowActions({
  user,
  onSelect,
  onDeactivate,
  onReactivate,
  onResetPassword,
}: UserRowActionsProps) {
  const { user: currentUser } = useAuth();
  const currentRole = (currentUser?.app_metadata?.app_role as string) ?? "";
  const canManage = canActorManageTarget(currentRole, user.app_role);
  const isSelf = currentUser?.id === user.id;
  const canResetPassword = Boolean(
    canManage &&
      !isSelf &&
      !user.deleted_at &&
      user.is_active &&
      ["owner", "org_admin"].includes(currentRole),
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <button
        onClick={onSelect}
        className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        Edit
      </button>
      {canResetPassword && !isSelf && !user.deleted_at && user.is_active && onResetPassword && (
        <button
          onClick={() => onResetPassword({ id: user.id, email: user.email })}
          className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          Reset password
        </button>
      )}
      {canManage && !isSelf && !user.deleted_at && user.is_active && onDeactivate && (
        <button
          onClick={() => onDeactivate()}
          className="text-xs px-2 py-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
        >
          Deactivate
        </button>
      )}
      {canManage && !isSelf && user.deleted_at && onReactivate && (
        <button
          onClick={() => onReactivate(user.id)}
          className="text-xs px-2 py-1 rounded text-primary hover:bg-muted transition-colors"
        >
          Reactivate
        </button>
      )}
    </div>
  );
}
