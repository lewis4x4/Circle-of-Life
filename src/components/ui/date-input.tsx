"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Native date control with Quiet Operator empty semantics — optional hint is explicit; no “today” ghost value. */
const DEFAULT_EMPTY_HINT = "Optional — renewal date MM/DD/YYYY";

export function DateInput(props: Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (isoDate: string) => void;
  /** Use `null` or `""` to hide the muted hint line when empty (e.g. parent already labeled the field). */
  emptyHint?: string | null;
}) {
  const { value, onValueChange, emptyHint, id, className, ...rest } = props;

  const resolvedHint =
    emptyHint === null || emptyHint === ""
      ? null
      : (emptyHint ?? DEFAULT_EMPTY_HINT);

  return (
    <div className="space-y-1">
      <input
        {...rest}
        id={id}
        type="date"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm md:text-sm",
          "transition-[color,box-shadow] outline-none placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
          !value && "[&::-webkit-datetime-edit-fields-wrapper]:text-transparent [&::-moz-placeholder]:opacity-0",
          className,
        )}
      />
      {resolvedHint != null && !value ? (
        <p className="text-[12px] text-muted-foreground">{resolvedHint}</p>
      ) : null}
    </div>
  );
}
