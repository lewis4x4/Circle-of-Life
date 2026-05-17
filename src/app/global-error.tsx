"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * GlobalError — top-level Next.js error boundary.
 *
 * Renders its own <html>/<body>, so the Quiet Operator critical-alert
 * pattern is applied inline (the route-group's CSS variables are not
 * available at this layer). Layout intentionally mirrors the
 * CriticalAlertBanner primitive — `bg-destructive/10` tint,
 * `border-destructive/30`, `text-destructive` headline + icon.
 *
 * Accessibility:
 *   - The <html> wrapper carries `dark` so the Quiet Operator dark
 *     palette resolves even when the broken render skipped layout.
 *   - The card has `role="alert"` + `aria-live="assertive"` — this is
 *     the genuinely-critical surface.
 *   - Retry uses `focus-visible:ring-2 focus-visible:ring-ring`.
 */
export default function GlobalError({
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
    <html lang="en" className="dark">
      <body className="flex min-h-screen items-center justify-center bg-background font-sans text-foreground antialiased">
        <div
          role="alert"
          aria-live="assertive"
          className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h1 className="text-base font-semibold tracking-tight text-destructive">
                Unable to load this page
              </h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. Try refreshing or contact support
                if the issue persists.
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
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-[var(--motion-duration-micro)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            >
              Retry
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
