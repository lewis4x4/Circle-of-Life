"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, User } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export interface ResidentOption {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  room?: string | null;
}

export interface ResidentSelectorProps {
  value: string;
  onChange: (residentId: string, residentName?: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function ResidentSelector({
  value,
  onChange,
  disabled = false,
  className = "",
  placeholder = "Select a resident",
}: ResidentSelectorProps) {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!isBrowserSupabaseConfigured()) {
      setError("System not configured");
      setLoading(false);
      return;
    }

    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLoading(false);
      return;
    }

    try {
      const res = await supabase
        .from("residents")
        .select("id, first_name, last_name, preferred_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("last_name, first_name")
        .limit(500);

      if (res.error) throw res.error;

      const options = (res.data ?? []).map((r: any) => {
        const firstName = r.preferred_name || r.first_name;
        const label = [firstName, r.last_name].filter(Boolean).join(" ");
        return {
          id: r.id,
          label,
          firstName,
          lastName: r.last_name,
          room: null,
        };
      });

      setResidents(options);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load residents");
      setResidents([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const selected = residents.find((r) => r.id === selectedId);
    onChange(selectedId, selected?.label);
  };

  return (
    <div className="relative">
      <select
        value={value}
        onChange={handleChange}
        disabled={disabled || loading}
        className={`
          w-full h-14 appearance-none rounded-[1.2rem] border
          border-slate-200 dark:border-white/10
          bg-white dark:bg-black/40
          px-5 text-[15px] font-medium
          text-slate-900 dark:text-white
          focus:outline-none focus:ring-2 focus:ring-indigo-500/50
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
      >
        <option value="">{loading ? "Loading residents..." : placeholder}</option>
        {residents.map((r) => (
          <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
            {r.label}
          </option>
        ))}
      </select>

      {/* Dropdown indicator */}
      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-2">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-slate-400" />
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {/* Selected facility hint */}
      {!loading && residents.length === 0 && !error && (
        <p className="mt-2 text-xs text-slate-500 dark:text-zinc-500">
          {selectedFacilityId
            ? "No active residents at this facility"
            : "Select a facility in the header first"}
        </p>
      )}
    </div>
  );
}

/**
 * Compact version for use in filters or tight spaces
 */
export interface ResidentSelectorCompactProps {
  value: string;
  onChange: (residentId: string) => void;
  facilityId: string;
  className?: string;
  placeholder?: string;
}

export function ResidentSelectorCompact({
  value,
  onChange,
  facilityId,
  className = "",
  placeholder = "Resident",
}: ResidentSelectorCompactProps) {
  const supabase = useMemo(() => createClient(), []);
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await supabase
          .from("residents")
          .select("id, first_name, last_name, preferred_name")
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .order("last_name, first_name")
          .limit(500);

        if (!cancelled && !res.error) {
          const options = (res.data ?? []).map((r: any) => {
            const firstName = r.preferred_name || r.first_name;
            const label = [firstName, r.last_name].filter(Boolean).join(" ");
            return {
              id: r.id,
              label,
              firstName,
              lastName: r.last_name,
              room: null,
            };
          });
          setResidents(options);
        }
      } catch {
        // Silently fail for compact version
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (facilityId) void load();

    return () => { cancelled = true; };
  }, [supabase, facilityId]);

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className={`
          w-full h-10 appearance-none rounded-lg border
          border-slate-200 dark:border-white/10
          bg-white dark:bg-black/40
          px-3 text-sm
          text-slate-900 dark:text-white
          focus:outline-none focus:ring-2 focus:ring-indigo-500/50
          disabled:opacity-50
          ${className}
        `}
      >
        <option value="">{loading ? "..." : placeholder}</option>
        {residents.map((r) => (
          <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
            {r.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
    </div>
  );
}
