"use client";

import React, { useState } from "react";
import { Loader2, Download, Filter } from "lucide-react";
import { useFacilityAuditLog } from "@/hooks/useFacilityAuditLog";

interface AuditTabProps {
  facilityId: string;
}

const inputCls = "w-full px-3 py-2 rounded-[8px] border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring";

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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-[8px] hover:bg-muted/10 transition-colors text-sm font-medium text-foreground"
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>

        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-[8px] hover:bg-muted/10 transition-colors text-sm font-medium text-foreground"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {filterOpen && (
        <div className="rounded-[8px] border border-border bg-muted/10 p-6 space-y-4">
          <h3 className="font-semibold text-foreground">Filter audit log</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Field name</label>
              <input
                type="text"
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value)}
                placeholder="e.g., status, occupancy"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">User</label>
              <input
                type="text"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder="Username or email"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleApplyFilters()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-[8px] text-sm font-medium"
            >
              Apply filters
            </button>
            <button
              onClick={() => void handleClearFilters()}
              className="px-4 py-2 border border-border rounded-[8px] hover:bg-muted/10 transition-colors text-sm font-medium text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-[8px] border border-border bg-muted/10 p-8 text-center">
          <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">No audit log entries</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/10">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Table</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Field</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Old value</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">New value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/10">
                  <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                    {new Date(entry.timestamp).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.user}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.table_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.field_name}</td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {entry.old_value ? (
                      <code className="bg-muted/10 border border-border px-2 py-1 rounded-[8px] text-foreground">{entry.old_value}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {entry.new_value ? (
                      <code className="bg-muted/10 border border-border px-2 py-1 rounded-[8px] text-foreground">{entry.new_value}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">{total} entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handlePageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded-[8px] border border-border disabled:opacity-40 hover:bg-muted/10 transition-colors text-foreground"
            >
              Previous
            </button>
            <span className="tabular-nums">Page {page}</span>
            <button
              onClick={() => void handlePageChange(page + 1)}
              disabled={!hasNext}
              className="px-3 py-1 rounded-[8px] border border-border disabled:opacity-40 hover:bg-muted/10 transition-colors text-foreground"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
