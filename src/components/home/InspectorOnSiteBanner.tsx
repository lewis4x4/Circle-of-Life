import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { openInspectionLine, type HomeOpenInspection } from "@/lib/home/inspector-on-site";

/**
 * Shown on the administrator's Home while an inspector or official is signed
 * in at this facility (COL-692, spec 40 §7). Read only; the visitor log is
 * where they are signed out.
 */
export function InspectorOnSiteBanner({ inspections, timeZone }: { inspections: HomeOpenInspection[]; timeZone: string }) {
  const line = openInspectionLine(inspections, timeZone);
  if (!line) return null;
  return (
    <section
      aria-label="Inspector in the building"
      data-testid="inspector-on-site"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        {line}
      </p>
      <Link
        href="/admin/front-desk"
        className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open the visitor log
      </Link>
    </section>
  );
}
