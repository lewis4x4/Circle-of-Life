"use client";

import React, { useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { useFacilities } from "@/hooks/useFacilities";
import { FacilityCard } from "@/components/admin/facilities/FacilityCard";

export default function FacilitiesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { facilities, isLoading, error, refetch } = useFacilities({ search, status });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-teal-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Facilities</h1>
            <p className="text-sm text-muted-foreground">Manage and monitor all facility operations</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search facilities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="under_renovation">Under Renovation</option>
            <option value="archived">Archived</option>
          </select>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        </div>
      ) : facilities.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-medium">No facilities found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Facilities are created during the onboarding process.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              redAlertCount={0}
              yellowAlertCount={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
