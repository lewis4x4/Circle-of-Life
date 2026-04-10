"use client";

import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type AdminFacilityOption = { id: string; name: string };

export type AdminFacilityScopeDropdownProps = {
  /** Selected facility id, or `null` for organization-wide (all facilities). */
  value: string | null;
  onChange: (facilityId: string | null) => void;
  facilities: AdminFacilityOption[];
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
  /** For label association / accessibility */
  id?: string;
  /** Visually hidden label text for screen readers */
  "aria-label"?: string;
  describedBy?: string;
  align?: "start" | "center" | "end";
  className?: string;
  triggerClassName?: string;
};

/**
 * Facility scope picker matching {@link AdminShell} header behavior:
 * "All facilities" plus one row per accessible site, checkmarks, same menu chrome.
 * Use for report runs, scenarios, or any in-page scope that mirrors the global selector.
 */
export function AdminFacilityScopeDropdown({
  value,
  onChange,
  facilities,
  loading = false,
  loadFailed = false,
  onRetry,
  disabled = false,
  id,
  "aria-label": ariaLabel = "Facility scope",
  describedBy,
  align = "start",
  className,
  triggerClassName,
}: AdminFacilityScopeDropdownProps) {
  const current = facilities.find((f) => f.id === value);
  const triggerLabel = loading
    ? "Loading facilities…"
    : value === null
      ? "All facilities"
      : (current?.name ?? "Select facility…");

  return (
    <div className={cn("w-full", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          disabled={disabled || loading}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-busy={loading}
          className={cn(
            "flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-slate-900 shadow-sm cursor-pointer",
            "hover:bg-slate-50 dark:border-white/10 dark:bg-black/40 dark:text-slate-200 dark:hover:bg-white/5",
            "tap-responsive transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
            "disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-slate-500 dark:text-zinc-400" aria-hidden />
            <span className="truncate">{triggerLabel}</span>
          </span>
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-zinc-500" aria-hidden />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-[min(100vw-2rem,260px)] rounded-[1.2rem] p-2 dark:border-white/10 dark:bg-zinc-950/95 dark:backdrop-blur-xl"
        >
          <DropdownMenuItem
            onClick={() => onChange(null)}
            className="flex cursor-pointer items-center justify-between rounded-lg p-3 font-medium dark:focus:bg-white/5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 dark:bg-white/10">
                <Building2 className="h-3 w-3" aria-hidden />
              </div>
              <span>All facilities</span>
            </div>
            {value === null && (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-1 dark:bg-white/10" />

          {loadFailed && (
            <div className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Could not load facilities.
              {onRetry ? (
                <button
                  type="button"
                  onClick={() => onRetry()}
                  className="mt-2 block text-indigo-600 underline dark:text-indigo-400"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}

          {facilities.map((facility) => (
            <DropdownMenuItem
              key={facility.id}
              onClick={() => onChange(facility.id)}
              className="flex cursor-pointer items-center justify-between rounded-lg p-3 dark:focus:bg-white/5"
            >
              <span className="truncate pr-2">{facility.name}</span>
              {value === facility.id && (
                <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
