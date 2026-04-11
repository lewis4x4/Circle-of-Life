"use client";

import React, { useState } from "react";
import { Loader2, Download, Filter } from "lucide-react";
import { useFacilityAuditLog } from "@/hooks/useFacilityAuditLog";

interface AuditTabProps {
  facilityId: string;
}

export function AuditTab({ facilityId }: AuditTabProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [fieldFilter, setFieldFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const { entries, isLoading, error, total, hasNext, refetch } = useFacilityAuditLog(facilityId);

  const currentFilters = {
    fieldName: fieldFilter,
    user: userFilter,
    startDate,
    endDate,
    pageSize: 20,
  };

  const handleApplyFilters = async () => {
    await refetch({
      ...currentFilters,
      page: 1,
    });
    setPage(1);
    setFilterOpen(false);
  };

  const handleClearFilters = async () => {
    setFieldFilter("");
    setUserFilter("");
    setStartDate("");
    setEndDate("");
    await refetch({ page: 1, pageSize: 20 });
    setPage(1);
  };

  const handlePageChange = async (nextPage: number) => {
    setPage(nextPage);
    await refetch({
      ...currentFilters,
      page: nextPage,
    });
  };

  const handleExport = () => {
    const csv = [
      ["Timestamp", "User", "Table", "Field", "Old Value", "New Value"],
      ...entries.map((e) => [
        new Date(e.timestamp).toLocaleString(),
        e.user,
        e.table_name,
        e.field_name,
        e.old_value ?? "",
        e.new_value ?? "",
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facility-audit-${facilityId}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter and Export Bar */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-slate-50/50 dark:bg-white/5 transition-colors text-sm font-medium"
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>

        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-slate-50/50 dark:bg-white/5 transition-colors text-sm font-medium"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Filter Panel */}
      {filterOpen && (
        <div className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 p-6 space-y-4">
          <h3 className="font-semibold">Filter Audit Log</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-2">Field Name</label>
              <input
                type="text"
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value)}
                placeholder="e.g., status, occupancy"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">User</label>
              <input
                type="text"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder="Username or email"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
            >
              Apply Filters
            </button>
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Audit Table */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 p-8 text-center">
          <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">No audit log entries</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200/50 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">User</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Table</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Field</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Old Value</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">New Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/50 dark:bg-white/5">
                  <td className="px-4 py-3 font-medium">
                    {new Date(entry.timestamp).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{entry.user}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{entry.table_name}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{entry.field_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {entry.old_value ? (
                      <code className="bg-gray-100 px-2 py-1 rounded text-slate-700 dark:text-slate-300">{entry.old_value}</code>
                    ) : (
                      <span className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {entry.new_value ? (
                      <code className="bg-gray-100 px-2 py-1 rounded text-slate-700 dark:text-slate-300">{entry.new_value}</code>
                    ) : (
                      <span className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>{total} entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handlePageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              onClick={() => void handlePageChange(page + 1)}
              disabled={!hasNext}
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
