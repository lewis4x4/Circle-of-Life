export type DataTableAlign = "left" | "right" | "center";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor: (row: T) => unknown;
  render?: (row: T) => React.ReactNode;
  align?: DataTableAlign;
  width?: number | string;
  sortable?: boolean;
  sticky?: boolean;
  /** Triggers tabular-nums rendering + threshold color rule when present. */
  numeric?: boolean;
  /** Matches a key in the thresholds map provided to the table. */
  metricKey?: string;
};

export type DataTableRowStatus = "ok" | "warning" | "critical";

export type DataTableRow<T> = {
  id: string;
  data: T;
  status?: DataTableRowStatus;
  /** Required when status !== "ok". */
  statusTooltip?: string;
};

export function alignToClass(align: DataTableAlign | undefined): string {
  switch (align) {
    case "right":
      return "text-right";
    case "center":
      return "text-center";
    default:
      return "text-left";
  }
}

export function rowStatusToDot(status: DataTableRowStatus | undefined): string {
  switch (status) {
    case "warning":
      return "bg-warning";
    case "critical":
      return "bg-danger";
    case "ok":
    default:
      return "bg-success";
  }
}
