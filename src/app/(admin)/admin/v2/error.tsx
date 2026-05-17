"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * V2DashboardError — error boundary for the UI-V2 admin surface.
 *
 * Quiet Operator critical-alert pattern (inline because UI-V2 pages may
 * not import primitives directly per ESLint `ui-v2/no-direct-primitive-import`):
 *   - bg-destructive/10 + border-destructive/30 (10/30 soft-tint policy)
 *   - text-destructive headline + icon; muted body for prose contrast
 *   - role="alert" + aria-live="assertive" — surface is genuinely critical
 *   - rounded-lg (matches Critical Alert surface 10px)
 *   - focus-visible:ring-2 focus-visible:ring-ring on every action
 *
 * Mirrors the CriticalAlertBanner primitive at
 * src/design-system/components/critical-alert/. Keep the two visually
 * aligned when one changes.
 */
export default function V2DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-base font-semibold tracking-tight text-destructive">
            Dashboard could not load
          </h1>
          <p className="text-sm text-muted-foreground">
            The V2 dashboard did not finish rendering. The V1 surface remains
            available — flip <code>NEXT_PUBLIC_UI_V2=false</code> in Netlify env
            to fall back. The error has been logged.
          </p>
          {error.digest && (
            <p className="text-xs tabular-nums text-muted-foreground">
              Reference: <span>{error.digest}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors duration-[var(--motion-duration-micro)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
