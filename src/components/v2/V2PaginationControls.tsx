"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  isV2PaginationOutOfRange,
  type V2PaginationMeta,
} from "@/lib/v2-pagination";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function V2PaginationControls({
  pagination,
  showCurrentPageExportNote,
}: {
  pagination: V2PaginationMeta;
  showCurrentPageExportNote?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isOutOfRange = isV2PaginationOutOfRange(pagination);
  const lastPage = Math.max(1, Math.ceil(pagination.totalCount / pagination.pageSize));
  const fromDisplay = pagination.totalCount === 0 || isOutOfRange ? 0 : pagination.from + 1;
  const toDisplay = isOutOfRange ? 0 : Math.min(pagination.to + 1, pagination.totalCount);

  const buildHref = (page: number, pageSize = pagination.pageSize) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-text-secondary">
      <span>
        {isOutOfRange
          ? `No rows on page ${pagination.page}; ${pagination.totalCount} total`
          : `Showing ${fromDisplay}–${toDisplay} of ${pagination.totalCount}`}
      </span>
      {showCurrentPageExportNote ? <span>· CSV exports current page</span> : null}
      <span>·</span>
      <span>Page size</span>
      {PAGE_SIZE_OPTIONS.map((size) =>
        size === pagination.pageSize ? (
          <span key={size} className="rounded-sm border border-border px-2 py-1 text-text-primary">
            {size}
          </span>
        ) : (
          <Link
            key={size}
            href={buildHref(1, size)}
            className="rounded-sm border border-border px-2 py-1 hover:border-border-strong hover:text-text-primary"
          >
            {size}
          </Link>
        ),
      )}
      {pagination.hasPreviousPage ? (
        <Link
          href={buildHref(isOutOfRange ? lastPage : pagination.page - 1)}
          className="rounded-sm border border-border px-2 py-1 hover:border-border-strong hover:text-text-primary"
        >
          {isOutOfRange ? "Last page" : "Prev"}
        </Link>
      ) : (
        <span className="rounded-sm border border-border px-2 py-1 opacity-50">Prev</span>
      )}
      {pagination.hasNextPage ? (
        <Link
          href={buildHref(pagination.page + 1)}
          className="rounded-sm border border-border px-2 py-1 hover:border-border-strong hover:text-text-primary"
        >
          Next
        </Link>
      ) : (
        <span className="rounded-sm border border-border px-2 py-1 opacity-50">Next</span>
      )}
    </div>
  );
}
