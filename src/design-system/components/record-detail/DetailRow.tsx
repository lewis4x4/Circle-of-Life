import * as React from "react";

import { cn } from "@/lib/utils";

import { FieldLabel } from "./QuietLabels";
import { RECORD_DETAIL_NO_VALUE_COPY } from "./record-detail-display-copy";

/** True when rendered text is blank or placeholder empty copy (Record Detail quiet-empty pattern). */
export function isRecordDetailEmptyValue(value: React.ReactNode): boolean {
  const text = collectPlainText(value)
    .replace(/\u00a0/g, " ")
    .trim();
  return text === "" || text === "—" || text === RECORD_DETAIL_NO_VALUE_COPY;
}

function collectPlainText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectPlainText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return collectPlainText(node.props.children);
  }
  return "";
}

export interface DetailRowProps {
  label: string;
  value: React.ReactNode;
}

/**
 * Label + value row for Record Detail sections. Empty values use
 * `text-muted-foreground/50` on both sides so populated rows dominate visual scan (FRONTEND-CONTRACT).
 */
export function DetailRow({ label, value }: DetailRowProps) {
  const empty = isRecordDetailEmptyValue(value);
  const mutedHalf = "text-muted-foreground/50";

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <FieldLabel className={cn("min-w-[8rem]", empty ? mutedHalf : undefined)}>{label}</FieldLabel>
      <div className={cn("min-w-0 text-[13px]", empty ? mutedHalf : "text-foreground")}>
        {empty ? RECORD_DETAIL_NO_VALUE_COPY : value}
      </div>
    </div>
  );
}
