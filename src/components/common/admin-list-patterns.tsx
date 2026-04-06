"use client";

import React from "react";
import { AlertTriangle, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type FilterOption = {
  value: string;
  label: string;
};

type AdminFilterBarProps = {
  searchValue: string;
  searchPlaceholder?: string;
  onSearchChange: (value: string) => void;
  filters: Array<{
    id: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
  }>;
  onReset: () => void;
};

export function AdminFilterBar({
  searchValue,
  searchPlaceholder = "Search",
  onSearchChange,
  filters,
  onReset,
}: AdminFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-indigo-500/10 bg-white/5 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/5 dark:bg-[#0A0A0A]/50 md:flex-row md:items-center md:justify-between relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-indigo-500/5 to-indigo-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
      <div className="flex w-full items-center gap-2 md:max-w-md relative z-10">
        <div className="rounded-xl border border-indigo-500/10 bg-white/50 p-2 text-indigo-500/70 dark:border-white/10 dark:bg-black/50 dark:text-indigo-400/70 backdrop-blur-md">
          <Search className="h-4 w-4" />
        </div>
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 border-slate-200/50 bg-white/50 dark:border-slate-800/50 dark:bg-black/40 focus-visible:ring-indigo-500/30 backdrop-blur-sm rounded-xl font-mono text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 relative z-10">
        {filters.map((filter) => (
          <select
            key={filter.id}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
            className="h-10 rounded-xl border border-slate-200/50 bg-white/60 px-3 text-sm text-slate-700 outline-none transition-colors focus:border-indigo-500/30 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800/60 dark:bg-black/40 dark:text-slate-300 font-mono focus:bg-white dark:focus:bg-black backdrop-blur-sm shadow-sm"
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value} className="bg-white dark:bg-slate-900">
                {option.label}
              </option>
            ))}
          </select>
        ))}

        <Button
          variant="outline"
          className="h-10 rounded-xl border-slate-200/50 bg-white/50 dark:border-slate-800/50 dark:bg-black/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 backdrop-blur-sm font-mono text-xs uppercase tracking-widest text-slate-500"
          onClick={onReset}
        >
          <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}

export function AdminTableLoadingState() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl dark:bg-[#0A0A0A]/40 shadow-2xl">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_2s_infinite] -translate-x-full" />
      <div className="space-y-4 relative z-10">
        <Skeleton className="h-10 w-full bg-slate-200/40 dark:bg-slate-800/40 rounded-xl" />
        <Skeleton className="h-[420px] w-full bg-slate-200/20 dark:bg-slate-800/20 rounded-xl" />
      </div>
    </div>
  );
}

/** Amber banner when live Supabase load failed and the page is showing demo / stale fallback rows. */
export function AdminLiveDataFallbackNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-50/30 p-4 backdrop-blur-xl dark:border-amber-900/40 dark:bg-amber-950/20 shadow-[0_4px_24px_rgba(245,158,11,0.05)]">
       <div className="absolute left-0 top-0 h-full w-1 bg-amber-500 rounded-l-2xl" />
       <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between relative z-10">
        <p className="text-sm font-mono text-amber-800 dark:text-amber-300 ml-2">{message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-9 shrink-0 rounded-xl border-amber-500/30 bg-white/50 font-mono text-xs uppercase tracking-widest text-amber-900 backdrop-blur-sm hover:bg-amber-100/50 dark:border-amber-800/50 dark:bg-black/50 dark:text-amber-200 dark:hover:bg-amber-950/60"
        >
          Re-engage
        </Button>
      </div>
    </div>
  );
}

type AdminErrorStateProps = {
  title?: string;
  message: string;
  onRetry: () => void;
};

export function AdminErrorState({
  title = "Could not load records",
  message,
  onRetry,
}: AdminErrorStateProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-red-50/10 backdrop-blur-xl dark:border-red-900/30 dark:bg-red-950/10 shadow-[inset_0_0_20px_rgba(239,68,68,0.02)]">
      <div className="absolute left-1/2 -top-1/2 -translate-x-1/2">
        <div className="h-[200px] w-[400px] rounded-full bg-red-500/10 blur-3xl" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4 py-14 text-center">
        <div className="rounded-2xl border border-red-500/20 bg-white/50 p-3 text-red-600 shadow-sm backdrop-blur-md dark:bg-black/50 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-display font-semibold text-red-700 dark:text-red-300">{title}</h3>
          <p className="mt-1 max-w-md text-sm font-mono text-red-600/80 dark:text-red-400/80">{message}</p>
        </div>
        <Button variant="outline" onClick={onRetry} className="h-10 rounded-xl border-red-500/20 bg-white/50 font-mono text-xs uppercase tracking-widest text-red-700 backdrop-blur-sm hover:bg-red-50 hover:text-red-800 dark:border-red-900/50 dark:bg-black/50 dark:text-red-400 dark:hover:bg-red-950/40">
          Retry Sequence
        </Button>
      </div>
    </div>
  );
}

type AdminEmptyStateProps = {
  title: string;
  description: string;
};

export function AdminEmptyState({ title, description }: AdminEmptyStateProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-indigo-500/20 bg-indigo-50/10 p-14 text-center backdrop-blur-xl dark:border-indigo-500/10 dark:bg-indigo-950/10">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[300px] w-[300px] rounded-full border border-indigo-500/10 bg-indigo-500/5 blur-3xl" />
      </div>
      <div className="relative z-10 flex flex-col items-center justify-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-500/20 bg-white/50 text-indigo-500 shadow-sm backdrop-blur-md dark:bg-black/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent" />
          <Search className="h-6 w-6 relative z-10 opacity-70" />
        </div>
        <h3 className="text-lg font-display font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm font-mono text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}
