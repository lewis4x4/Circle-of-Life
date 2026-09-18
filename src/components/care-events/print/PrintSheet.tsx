"use client";

import { useState, type ReactNode } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { printFooterLine } from "@/lib/care-events/print";

export type PrintSheetProps = {
  title: string;
  facilityName: string;
  timeZone: string;
  children: ReactNode;
};

/**
 * The page furniture every COL-354 sheet shares: the letterhead block, the
 * "who is at the printer" field, the print button, and the footer line the
 * decision fixes word for word.
 *
 * The printed-by name is typed here and is never stored. The person standing at
 * the printer is not always the person signed in, and a printout that claims
 * otherwise is worse than a blank line.
 */
export function PrintSheet({ title, facilityName, timeZone, children }: PrintSheetProps) {
  const [printedBy, setPrintedBy] = useState("");
  const [printedAt] = useState(() => new Date());

  return (
    <div className="print-sheet mx-auto w-full max-w-[8.5in] bg-white p-6 text-black">
      <div data-print-hide className="mb-6 flex flex-wrap items-end gap-3 border-b border-neutral-300 pb-4">
        <label className="flex-1 text-sm">
          <span className="block font-medium text-neutral-700">Who is printing this?</span>
          <input
            type="text"
            value={printedBy}
            onChange={(event) => setPrintedBy(event.target.value)}
            placeholder="Your name, for the footer"
            className="mt-1 h-11 w-full rounded-lg border border-neutral-300 px-3 text-base text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
          />
          <span className="mt-1 block text-xs text-neutral-600">Printed on the footer only. Not saved.</span>
        </label>
        <Button type="button" onClick={() => window.print()} className="h-11">
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
      </div>

      <header className="print-section mb-5 border-b-2 border-black pb-3">
        <p className="text-sm font-semibold uppercase tracking-wide">{facilityName}</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      </header>

      {children}

      <footer className="print-section mt-8 border-t border-neutral-400 pt-2 text-xs text-neutral-700">
        {printFooterLine({ printedBy, printedAt, facilityName, timeZone })}
      </footer>
    </div>
  );
}
