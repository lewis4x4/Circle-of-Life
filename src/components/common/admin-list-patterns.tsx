"use client";

import React from "react";
import { AlertTriangle, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Outer shell for dense operator hub lists (`TableRow` stacks). Mirrors Record Detail discrete cards (`rounded-xl` + subtle ring per FRONTEND-CONTRACT §7–§8). */
const OPERATIONAL_LIST_PANEL_CLASS =
  "overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60";

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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 md:flex-row md:items-center md:justify-between">
      <div className="relative flex w-full items-center md:max-w-md">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 pl-8 text-[13px] bg-transparent"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <select
            key={filter.id}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
            className={cn(
              "h-8 rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground",
              "transition-colors hover:bg-secondary/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "tabular-nums",
            )}
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value} className="bg-card">
                {option.label}
              </option>
            ))}
          </select>
        ))}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[12px] text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          <X className="mr-1 size-3.5" aria-hidden />
          Reset
        </Button>
      </div>
    </div>
  );
}

type AdminOperationalListPanelProps = {
  /** Optional top row inside the panel (section title + actions). Omit when headers + rows suffice. */
  toolbar?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function AdminOperationalListPanel({ toolbar, className, children }: AdminOperationalListPanelProps) {
  return (
    <div className={cn(OPERATIONAL_LIST_PANEL_CLASS, className)}>
      {toolbar != null ? (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-[13px] py-2">
          {toolbar}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function AdminTableLoadingState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] ring-1 ring-border/60",
        className,
      )}
    >
      <Skeleton className="h-8 w-full bg-muted" />
      <Skeleton className="h-9 w-full bg-muted" />
      <Skeleton className="h-9 w-full bg-muted" />
      <Skeleton className="h-9 w-full bg-muted" />
      <Skeleton className="h-9 w-full bg-muted" />
    </div>
  );
}

/** Slim banner when live Supabase load failed and the page is showing fallback rows. */
export function AdminLiveDataFallbackNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
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
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
    </div>
  );
}

type AdminEmptyStateProps = {
  title: string;
  description: string;
};

/**
 * Left-aligned, two-line empty state per DESIGN_PRINCIPLES.md §11.
 *
 * Bold title + muted helper, no centered giant icon, no `h-[…]` filler, no
 * gradient halo.
 */
export function AdminEmptyState({ title, description }: AdminEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
