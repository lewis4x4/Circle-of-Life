/**
 * UserListView — fetches, filters, and paginates the user list.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { UserDataTable } from "./UserDataTable";
import { UserFilterBar } from "./UserFilterBar";

interface UserListViewProps {
  showDeactivated: boolean;
  onShowDeactivatedChange: (v: boolean) => void;
  onSelectUser: (id: string) => void;
  onDeactivate: (id: string) => void;
  onReactivate: (id: string) => void;
}

export function UserListView({
  showDeactivated,
  onShowDeactivatedChange,
  onSelectUser,
  onDeactivate,
  onReactivate,
}: UserListViewProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("active");
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, page_size: 20, total_pages: 0, has_next: false });
  const [isLoading, setIsLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: "20",
        status,
        sort_by: "full_name",
        sort_order: "asc",
      });
      if (search) params.set("search", search);
      if (role) params.set("role", role);
      if (facilityId) params.set("facility_id", facilityId);

      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const json = await res.json();
      let data = json.data ?? [];
      let paginationData = json.pagination ?? { total: 0, page: 1, page_size: 20, total_pages: 0, has_next: false };

      if (showDeactivated) {
        const deactivatedParams = new URLSearchParams(params);
        deactivatedParams.set("status", "deleted");
        const deactivatedRes = await fetch(`/api/admin/users?${deactivatedParams}`);
        if (deactivatedRes.ok) {
          const deactivatedJson = await deactivatedRes.json();
          data = [...data, ...(deactivatedJson.data ?? [])];
          const total = paginationData.total + (deactivatedJson.pagination?.total ?? 0);
          paginationData = {
            ...paginationData,
            total,
            total_pages: Math.ceil(total / paginationData.page_size),
            has_next: page * paginationData.page_size < total,
          };
        }
      }

      setUsers(data);
      setPagination(paginationData);
    } catch (err) {
      console.error("[user-list] fetch error:", err);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, role, facilityId, status, showDeactivated]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, role, facilityId, status, showDeactivated]);

  return (
    <div className="space-y-4">
      <UserFilterBar
        search={search}
        role={role}
        facilityId={facilityId}
        status={status}
        showDeactivated={showDeactivated}
        onSearchChange={setSearch}
        onRoleChange={setRole}
        onFacilityChange={setFacilityId}
        onStatusChange={setStatus}
        onShowDeactivatedChange={onShowDeactivatedChange}
      />

      <UserDataTable
        users={users}
        isLoading={isLoading}
        onSelectUser={onSelectUser}
        onDeactivate={onDeactivate}
        onReactivate={onReactivate}
      />

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {pagination.total} user{pagination.total !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Previous
            </button>
            <span>
              Page {page} of {pagination.total_pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
              disabled={!pagination.has_next}
              className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
