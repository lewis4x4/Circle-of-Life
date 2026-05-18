"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FileInputProps = {
  /** Controlled selected files — leave undefined for uncontrolled. */
  value?: FileList | File[];
  /** Uncontrolled baseline; ignored when controlled. */
  defaultFiles?: FileList | null;
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  className?: string;
  browseLabel?: string;
};

/** Styled file picker (multi-capable); replaces native “Choose file / No file chosen”. */
export function FileInput(props: FileInputProps) {
  const {
    onChange,
    multiple = false,
    accept,
    disabled,
    className,
    browseLabel = "Browse files…",
    value: controlled,
  } = props;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [internal, setInternal] = React.useState<File[]>([]);

  const files = React.useMemo(() => {
    if (controlled == null) return internal;
    if (controlled instanceof Array) return controlled;
    return Array.from(controlled);
  }, [controlled, internal]);

  const summary =
    files.length === 0
      ? "No files selected"
      : files.length === 1
        ? files[0]!.name
        : `${files.length} files selected`;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files ? Array.from(e.target.files) : [];
    if (controlled == null) setInternal(next);
    onChange(next);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="gap-1.5"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden />
        {browseLabel}
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={summary}>
        {summary}
      </span>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
      />
    </div>
  );
}
