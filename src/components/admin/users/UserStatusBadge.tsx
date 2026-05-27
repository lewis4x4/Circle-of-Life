/**
 * UserStatusBadge — displays active/inactive/deactivated status.
 */

"use client";

import { Badge } from "@/components/ui/badge";

interface UserStatusBadgeProps {
  is_active: boolean;
  deleted_at: string | null;
}

export function UserStatusBadge({ is_active, deleted_at }: UserStatusBadgeProps) {
  if (deleted_at) {
    return (
      <Badge variant="secondary" className="bg-muted text-[10px] text-muted-foreground">
        Deactivated
      </Badge>
    );
  }
  if (!is_active) {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Inactive
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
      Active
    </Badge>
  );
}
