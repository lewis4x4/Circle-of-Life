"use client";

import React from "react";
import { AlertTriangle, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  /** Optional ref for global `/` focus shortcuts (billing / other hubs). */
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  filters: Array<{
    id: string;
    ariaLabel?: string;
    /** Optional leading glyph inside the trigger (Quiet Operator funnel icon, etc.). */
    triggerPrefix?: React.ReactNode;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
  }>;
  onReset: () => void;
  /** Hide reset until search or filters differ from defaults (first option per filter). */
  suppressResetUnlessDirty?: boolean;
  /** Eg. export / facility pickers that share the filter row. */
  trailingSlot?: React.ReactNode;
};

export function AdminFilterBar(props: AdminFilterBarProps) {
  const {
    searchValue,
    searchPlaceholder = "Search",
    searchInputRef,
    onSearchChange,
    filters,
    onReset,
    suppressResetUnlessDirty = false,
  } = props;
  const filtersActive =
    searchValue.trim().length > 0 ||
    filters.some((f) => {
      const first = f.options[0]?.value;
      return first !== undefined && f.value !== first;
    });
  const showReset = !suppressResetUnlessDirty || filtersActive;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 md:flex-row md:items-center md:justify-between">
      <div className="relative flex w-full items-center md:max-w-md">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden />
        <Input
          ref={searchInputRef}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 pl-8 text-[13px] bg-transparent"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <Select key={filter.id} value={filter.value} onValueChange={filter.onChange}>
            <SelectTrigger
              id={`${filter.id}-trigger`}
              className="h-8 w-[min(100vw-2rem,200px)] min-w-[140px] gap-2 rounded-md border border-input bg-card px-3 text-[13px] text-foreground shadow-none"
              aria-label={filter.ariaLabel ?? filter.id}
            >
              {filter.triggerPrefix != null ? (
                <span className="shrink-0 text-muted-foreground" aria-hidden>
                  {filter.triggerPrefix}
                </span>
              ) : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[13px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {props.trailingSlot}

        {showReset ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-2 text-[12px]",
              filtersActive ? "text-foreground hover:text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={onReset}
          >
            <X className="mr-1 size-3.5" aria-hidden />
            Reset
          </Button>
        ) : null}
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
