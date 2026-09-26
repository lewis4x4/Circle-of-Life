"use client";

import { useId, useRef, useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The statement that applies a margin, shown for Brian to run. The page never
 * writes the setting. Copy confirms through a polite live region. Key it by
 * type so the confirmation does not carry over to another type's text.
 */
export function SettingChange({ sql }: { sql: string }) {
  const headingId = useId();
  const preRef = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setStatus("Copied.");
    } catch {
      const range = document.createRange();
      if (preRef.current) {
        range.selectNodeContents(preRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setStatus("Copy is blocked in this browser. The text is selected; press Command+C or Ctrl+C.");
    }
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-xs font-semibold text-muted-foreground">
          Setting change for Brian to apply
        </h4>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden />
          Copy
        </Button>
      </div>
      <pre
        ref={preRef}
        tabIndex={0}
        aria-label="Setting change statement"
        className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {sql}
      </pre>
      <p className="text-xs text-muted-foreground">This page never changes the setting. Jev pre-selection changes only after the statement is run.</p>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-foreground">
        {status}
      </p>
    </section>
  );
}
