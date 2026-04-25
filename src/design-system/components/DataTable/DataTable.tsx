"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type Table as ReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { csvEscapeCell } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

import {
  alignToClass,
  rowStatusToDot,
  type DataTableColumn,
  type DataTableRow,
  type DataTableRowStatus,
} from "./columns";
import { useDashboardPreferences } from "./preferences";
import {
  resolveThresholdState,
  thresholdStateToToneClass,
  type ThresholdMap,
} from "./thresholds";

export type DataTableExportFormat = "csv" | "xlsx" | "pdf";

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: DataTableRow<T>[];
  thresholds?: ThresholdMap;
  userPreferencesKey: string;
  onRowOpenPanel?: (id: string, row: T) => void;
  onRowOpenNewTab?: (id: string, row: T) => void;
  onCustomize?: () => void;
  onExport?: (format: DataTableExportFormat) => Promise<void>;
  emptyState?: React.ReactNode;
  loadingState?: "skeleton" | "shimmer" | "off";
  loading?: boolean;
  /** Disable Customize/Export persistence + UI (preview/test). */
  disablePreferences?: boolean;
  /** Render the virtualized list when row count exceeds this. Default 100. */
  virtualizeThreshold?: number;
  className?: string;
  caption?: string;
};

const DEFAULT_VIRTUAL_THRESHOLD = 100;

const noopPreferencesFetch: typeof fetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        dashboardId: "",
        columnOrder: [],
        columnVisibility: {},
        savedViews: [],
        exists: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

export function DataTable<T>({
  columns,
  rows,
  thresholds,
  userPreferencesKey,
  onRowOpenPanel,
  onRowOpenNewTab,
  onCustomize,
  onExport,
  emptyState,
  loadingState = "skeleton",
  loading = false,
  disablePreferences = false,
  virtualizeThreshold = DEFAULT_VIRTUAL_THRESHOLD,
  className,
  caption,
}: DataTableProps<T>) {
  // When preferences are disabled (preview/test), point the hook at a no-op
  // fetch so it never hits the network and exits its loading state cleanly.
  const fetchImpl = disablePreferences
    ? noopPreferencesFetch
    : undefined;
  const prefsHook = useDashboardPreferences(userPreferencesKey, { fetchImpl });
  const prefs = disablePreferences ? null : prefsHook.preferences;

  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [localVisibility, setLocalVisibility] = useState<Record<string, boolean> | null>(
    null,
  );

  const order = useMemo<string[]>(() => {
    if (localOrder) return localOrder;
    if (prefs?.columnOrder?.length) return prefs.columnOrder;
    return columns.map((c) => c.id);
  }, [columns, localOrder, prefs?.columnOrder]);

  const visibility = useMemo<Record<string, boolean>>(() => {
    if (localVisibility) return localVisibility;
    if (prefs?.columnVisibility) return prefs.columnVisibility;
    return Object.fromEntries(columns.map((c) => [c.id, true]));
  }, [columns, localVisibility, prefs?.columnVisibility]);

  const visibleColumns = useMemo<DataTableColumn<T>[]>(() => {
    const idToColumn = new Map(columns.map((c) => [c.id, c]));
    const ordered = order
      .map((id) => idToColumn.get(id))
      .filter((c): c is DataTableColumn<T> => Boolean(c));
    const missing = columns.filter((c) => !order.includes(c.id));
    return [...ordered, ...missing].filter((c) => visibility[c.id] !== false);
  }, [columns, order, visibility]);

  const tableColumns = useMemo<ColumnDef<DataTableRow<T>>[]>(() => {
    return visibleColumns.map((col) => ({
      id: col.id,
      header: col.header,
      accessorFn: (row) => col.accessor(row.data),
      cell: ({ row }) => renderCell(col, row.original),
      meta: col,
    }));
  }, [visibleColumns]);

  const tableData = useMemo(() => rows, [rows]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 returns non-memoizable functions; safe here because we don't memoize across the table boundary.
  const table = useReactTable<DataTableRow<T>>({
    data: tableData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = rows.length >= virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? table.getRowModel().rows.length : 0,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  const handleReorder = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = order.slice();
      const idx = current.indexOf(id);
      const next = idx + direction;
      if (idx < 0 || next < 0 || next >= current.length) return;
      [current[idx], current[next]] = [current[next]!, current[idx]!];
      setLocalOrder(current);
      if (!disablePreferences) prefsHook.setColumnOrder(current);
    },
    [disablePreferences, order, prefsHook],
  );

  const handleToggleVisibility = useCallback(
    (id: string) => {
      const next = { ...visibility, [id]: !(visibility[id] !== false) };
      setLocalVisibility(next);
      if (!disablePreferences) prefsHook.setColumnVisibility(next);
    },
    [disablePreferences, prefsHook, visibility],
  );

  const handleResetCustomize = useCallback(() => {
    setLocalOrder(null);
    setLocalVisibility(null);
    if (!disablePreferences) prefsHook.resetToDefaults();
    onCustomize?.();
  }, [disablePreferences, onCustomize, prefsHook]);

  const handleClientCsvExport = useCallback(() => {
    const headerLine = visibleColumns.map((c) => csvEscapeCell(c.header)).join(",");
    const lines = rows.map((row) =>
      visibleColumns
        .map((column) => {
          const v = column.accessor(row.data);
          if (v == null) return "";
          return csvEscapeCell(String(v));
        })
        .join(","),
    );
    const blob = new Blob([[headerLine, ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${userPreferencesKey.replace(/[^a-z0-9_-]/gi, "-")}-export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [rows, userPreferencesKey, visibleColumns]);

  const handleExport = useCallback(
    async (format: DataTableExportFormat) => {
      if (onExport) {
        await onExport(format);
        return;
      }
      if (format === "csv") {
        handleClientCsvExport();
        return;
      }
      // Caller-implemented formats land later; fall back to CSV in test stub.
      handleClientCsvExport();
    },
    [handleClientCsvExport, onExport],
  );

  const numericClass = "tabular-nums";
  const empty = !loading && rows.length === 0;

  return (
    <div
      data-virtualized={shouldVirtualize ? "true" : "false"}
      className={cn("flex flex-col gap-2 rounded-md border border-border bg-surface", className)}
    >
      <Toolbar
        columns={columns}
        order={order}
        visibility={visibility}
        onReorder={handleReorder}
        onToggleVisibility={handleToggleVisibility}
        onReset={handleResetCustomize}
        onExport={handleExport}
        savingPrefs={!disablePreferences && prefsHook.saving}
      />

      <div
        ref={containerRef}
        className={cn("relative overflow-auto", shouldVirtualize ? "max-h-[480px]" : "")}
      >
        <table aria-label={caption ?? userPreferencesKey} className="w-full text-sm text-text-primary">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface-elevated">
            <tr>
              <th scope="col" className="w-8 px-2 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">
                <span className="sr-only">Status</span>
              </th>
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const meta = header.column.columnDef.meta as DataTableColumn<T> | undefined;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted",
                      alignToClass(meta?.align),
                      meta?.sticky && "sticky left-0 z-20 bg-surface-elevated",
                    )}
                    style={meta?.width ? { width: meta.width } : undefined}
                  >
                    {meta?.header ?? String(header.column.columnDef.header ?? "")}
                  </th>
                );
              })}
              <th scope="col" className="w-24 px-2 py-2 text-right text-xs font-semibold uppercase tracking-caps text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={visibleColumns.length} variant={loadingState} />
            ) : empty ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="px-3 py-6 text-center text-xs text-text-muted">
                  {emptyState ?? "No rows in scope."}
                </td>
              </tr>
            ) : shouldVirtualize ? (
              <VirtualizedRows<T>
                table={table}
                visibleColumns={visibleColumns}
                thresholds={thresholds}
                onRowOpenPanel={onRowOpenPanel}
                onRowOpenNewTab={onRowOpenNewTab}
                virtualizer={virtualizer}
                numericClass={numericClass}
              />
            ) : (
              table.getRowModel().rows.map((tableRow) => (
                <DataRowEl<T>
                  key={tableRow.id}
                  row={tableRow}
                  visibleColumns={visibleColumns}
                  thresholds={thresholds}
                  onRowOpenPanel={onRowOpenPanel}
                  onRowOpenNewTab={onRowOpenNewTab}
                  numericClass={numericClass}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ToolbarProps<T> = {
  columns: DataTableColumn<T>[];
  order: string[];
  visibility: Record<string, boolean>;
  onReorder: (id: string, direction: -1 | 1) => void;
  onToggleVisibility: (id: string) => void;
  onReset: () => void;
  onExport: (format: DataTableExportFormat) => Promise<void>;
  savingPrefs: boolean;
};

function Toolbar<T>({
  columns,
  order,
  visibility,
  onReorder,
  onToggleVisibility,
  onReset,
  onExport,
  savingPrefs,
}: ToolbarProps<T>) {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(event.target as Node)) {
        setCustomizeOpen(false);
      }
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Data table toolbar"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2"
    >
      <span className="text-xs text-text-muted">
        {savingPrefs ? "Saving preferences…" : "Sticky header · keyboard navigable"}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={customizeRef}>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={customizeOpen}
            onClick={() => setCustomizeOpen((prev) => !prev)}
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Customize
          </button>
          {customizeOpen && (
            <div
              role="dialog"
              aria-label="Customize columns"
              className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border bg-surface-elevated p-3 shadow-popover"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
                Columns
              </p>
              <ul className="flex flex-col gap-1">
                {order.map((id) => {
                  const column = columns.find((c) => c.id === id);
                  if (!column) return null;
                  const checked = visibility[id] !== false;
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-2 py-1"
                    >
                      <label className="flex items-center gap-2 text-xs text-text-primary">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleVisibility(id)}
                          className="h-3 w-3 accent-brand-primary"
                        />
                        {column.header}
                      </label>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${column.header} up`}
                          onClick={() => onReorder(id, -1)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border text-xs text-text-secondary hover:border-border-strong"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${column.header} down`}
                          onClick={() => onReorder(id, 1)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border text-xs text-text-secondary hover:border-border-strong"
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setCustomizeOpen(false);
                }}
                className="mt-3 text-xs font-semibold text-brand-primary hover:text-brand-primary-hover"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>
        <div className="relative" ref={exportRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((prev) => !prev)}
            className="inline-flex h-8 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Export
          </button>
          {exportOpen && (
            <ul
              role="menu"
              aria-label="Export format"
              className="absolute right-0 top-9 z-30 w-40 rounded-md border border-border bg-surface-elevated p-1 shadow-popover"
            >
              {(["csv", "xlsx", "pdf"] as const).map((format) => (
                <li key={format} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void onExport(format);
                      setExportOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  >
                    <span>Export {format.toUpperCase()}</span>
                    {format !== "csv" && (
                      <span className="text-text-muted">stub</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type DataRowProps<T> = {
  row: Row<DataTableRow<T>>;
  visibleColumns: DataTableColumn<T>[];
  thresholds: ThresholdMap | undefined;
  onRowOpenPanel?: (id: string, row: T) => void;
  onRowOpenNewTab?: (id: string, row: T) => void;
  numericClass: string;
};

function DataRowEl<T>({
  row,
  visibleColumns,
  thresholds,
  onRowOpenPanel,
  onRowOpenNewTab,
  numericClass,
}: DataRowProps<T>) {
  const original = row.original;
  return (
    <tr
      data-row-id={original.id}
      data-status={original.status ?? "ok"}
      className="border-b border-border last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
    >
      <td className="w-8 px-2 py-2 align-middle">
        <RowStatusDot status={original.status} tooltip={original.statusTooltip} />
      </td>
      {visibleColumns.map((column) => (
        <td
          key={column.id}
          className={cn(
            "px-3 py-2 align-middle",
            alignToClass(column.align),
            column.numeric && numericClass,
            column.numeric && metricToneClass(column, original.data, thresholds),
            column.sticky && "sticky left-0 z-10 bg-surface",
          )}
          style={column.width ? { width: column.width } : undefined}
        >
          {column.render ? column.render(original.data) : renderAccessor(column, original.data)}
        </td>
      ))}
      <td className="w-24 px-2 py-2 align-middle text-right">
        <RowActions
          rowId={original.id}
          row={original.data}
          onRowOpenPanel={onRowOpenPanel}
          onRowOpenNewTab={onRowOpenNewTab}
        />
      </td>
    </tr>
  );
}

function VirtualizedRows<T>({
  table,
  visibleColumns,
  thresholds,
  onRowOpenPanel,
  onRowOpenNewTab,
  virtualizer,
  numericClass,
}: {
  table: ReactTable<DataTableRow<T>>;
  visibleColumns: DataTableColumn<T>[];
  thresholds: ThresholdMap | undefined;
  onRowOpenPanel?: (id: string, row: T) => void;
  onRowOpenNewTab?: (id: string, row: T) => void;
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  numericClass: string;
}) {
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const rows = table.getRowModel().rows;

  return (
    <>
      {items[0]?.start ? (
        <tr aria-hidden="true" style={{ height: items[0].start }}>
          <td colSpan={visibleColumns.length + 2} />
        </tr>
      ) : null}
      {items.map((virtualItem) => {
        const row = rows[virtualItem.index];
        if (!row) return null;
        return (
          <DataRowEl<T>
            key={row.id}
            row={row}
            visibleColumns={visibleColumns}
            thresholds={thresholds}
            onRowOpenPanel={onRowOpenPanel}
            onRowOpenNewTab={onRowOpenNewTab}
            numericClass={numericClass}
          />
        );
      })}
      {items.length > 0 && totalSize > items[items.length - 1]!.end ? (
        <tr aria-hidden="true" style={{ height: totalSize - items[items.length - 1]!.end }}>
          <td colSpan={visibleColumns.length + 2} />
        </tr>
      ) : null}
    </>
  );
}

function RowStatusDot({
  status,
  tooltip,
}: {
  status: DataTableRowStatus | undefined;
  tooltip?: string;
}) {
  const label =
    status && status !== "ok"
      ? tooltip ?? `Row status: ${status}`
      : "Row status: ok";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 rounded-full", rowStatusToDot(status))}
    />
  );
}

function RowActions<T>({
  rowId,
  row,
  onRowOpenPanel,
  onRowOpenNewTab,
}: {
  rowId: string;
  row: T;
  onRowOpenPanel?: (id: string, row: T) => void;
  onRowOpenNewTab?: (id: string, row: T) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {onRowOpenPanel && (
        <button
          type="button"
          aria-label={`Open row ${rowId} in panel`}
          title="Open in panel"
          onClick={() => onRowOpenPanel(rowId, row)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface-elevated text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          ▤
        </button>
      )}
      {onRowOpenNewTab && (
        <button
          type="button"
          aria-label={`Open row ${rowId} in new tab`}
          title="Open in new tab"
          onClick={() => onRowOpenNewTab(rowId, row)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface-elevated text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          ↗
        </button>
      )}
    </span>
  );
}

function SkeletonRows({
  columns,
  variant,
}: {
  columns: number;
  variant: "skeleton" | "shimmer" | "off";
}) {
  if (variant === "off") return null;
  return (
    <>
      {[0, 1, 2].map((index) => (
        <tr key={index} aria-hidden="true">
          <td className="w-8 px-2 py-3">
            <span className="block h-2 w-2 rounded-full bg-surface-elevated animate-pulse" />
          </td>
          {Array.from({ length: columns }).map((_, columnIdx) => (
            <td key={columnIdx} className="px-3 py-3">
              <span className="block h-3 w-3/4 rounded-sm bg-surface-elevated animate-pulse" />
            </td>
          ))}
          <td className="w-24 px-2 py-3 text-right">
            <span className="inline-block h-3 w-12 rounded-sm bg-surface-elevated animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );
}

function renderCell<T>(
  column: DataTableColumn<T>,
  row: DataTableRow<T>,
): React.ReactNode {
  if (column.render) return column.render(row.data);
  return renderAccessor(column, row.data);
}

function renderAccessor<T>(column: DataTableColumn<T>, data: T): React.ReactNode {
  const value = column.accessor(data);
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function metricToneClass<T>(
  column: DataTableColumn<T>,
  data: T,
  thresholds: ThresholdMap | undefined,
): string | undefined {
  if (!column.metricKey || !thresholds) return undefined;
  const spec = thresholds[column.metricKey];
  if (!spec) return undefined;
  const raw = column.accessor(data);
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return thresholdStateToToneClass(resolveThresholdState(numeric, spec));
}
