/**
 * UserDataTable — sortable user list with row selection.
 */

"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { UserStatusBadge } from "./UserStatusBadge";
import { UserRowActions } from "./UserRowActions";
import { ROLE_LABELS } from "@/lib/rbac";

interface UserData {
  id: string;
  email: string;
  full_name: string;
  app_role: string;
  job_title: string | null;
  is_active: boolean;
  deleted_at: string | null;
  last_login_at: string | null;
  facilities: Array<{ facility_id: string; facility_name: string; is_primary: boolean }>;
}

interface UserDataTableProps {
  users: UserData[];
  isLoading: boolean;
  onSelectUser: (id: string) => void;
  onDeactivate: (id: string) => void;
  onReactivate: (id: string) => void;
}

export function UserDataTable({
  users,
  isLoading,
  onSelectUser,
  onDeactivate,
  onReactivate,
}: UserDataTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No users found matching your filters.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">Facility</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Last Login</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onSelectUser(user.id)}>
              <TableCell className="font-medium">
                <div>
                  {user.full_name}
                  {user.job_title && (
                    <div className="text-xs text-muted-foreground font-normal">{user.job_title}</div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
              <TableCell className="text-sm">{ROLE_LABELS[user.app_role] ?? user.app_role}</TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {user.facilities
                  .filter((f) => f.is_primary)
                  .map((f) => f.facility_name)
                  .join(", ") || "—"}
              </TableCell>
              <TableCell>
                <UserStatusBadge is_active={user.is_active} deleted_at={user.deleted_at} />
              </TableCell>
              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                {user.last_login_at
                  ? new Date(user.last_login_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "Never"}
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <UserRowActions
                  user={user}
                  onSelect={() => onSelectUser(user.id)}
                  onDeactivate={onDeactivate}
                  onReactivate={onReactivate}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
