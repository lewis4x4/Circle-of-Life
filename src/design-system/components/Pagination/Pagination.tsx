"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PaginationProps = {
  /** 1-based */
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  className?: string;
};

/** Minimal operator pagination primitive — prev/next with page indicator. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;

  const safePage = Math.min(Math.max(page, 1), pageCount);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={safePage <= 1}
        onClick={() => onPageChange(Math.max(1, safePage - 1))}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {safePage} of {pageCount}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={safePage >= pageCount}
        onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
      >
        Next
      </Button>
    </nav>
  );
}
