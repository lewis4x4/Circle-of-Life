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
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 md:flex-row md:items-center md:justify-between">
      <div className="flex w-full items-center gap-2 md:max-w-md">
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Search className="h-4 w-4" />
        </div>
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <select
            key={filter.id}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}

        <Button
          variant="outline"
          className="h-10 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          onClick={onReset}
        >
          <SlidersHorizontal className="mr-1 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}

export function AdminTableLoadingState() {
  return (
    <Card className="border-slate-200/70 bg-white dark:border-slate-800 dark:bg-slate-950">
      <CardContent className="space-y-4 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </CardContent>
    </Card>
  );
}

type AdminErrorStateProps = {
  message: string;
  onRetry: () => void;
};

export function AdminErrorState({ message, onRetry }: AdminErrorStateProps) {
  return (
    <Card className="border-red-200/80 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/20">
      <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="rounded-full bg-red-100 p-3 text-red-600 dark:bg-red-900/40 dark:text-red-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-red-700 dark:text-red-300">Could not load residents</h3>
          <p className="mt-1 text-sm text-red-600/90 dark:text-red-300/80">{message}</p>
        </div>
        <Button variant="outline" onClick={onRetry} className="border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

type AdminEmptyStateProps = {
  title: string;
  description: string;
};

export function AdminEmptyState({ title, description }: AdminEmptyStateProps) {
  return (
    <Card className="border-dashed border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      <CardContent className="py-14 text-center">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </CardContent>
    </Card>
  );
}
