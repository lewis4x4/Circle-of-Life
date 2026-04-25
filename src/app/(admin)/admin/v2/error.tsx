"use client";

import { useEffect } from "react";

export default function V2DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[ui-v2] dashboard render failed", error);
    }
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-3 rounded-md border border-danger bg-surface-subtle p-4"
    >
      <h1 className="text-lg font-semibold text-danger">
        Dashboard could not load
      </h1>
      <p className="text-sm text-text-secondary">
        Something went wrong rendering this V2 dashboard. The V1 surface remains
        available; flip <code>NEXT_PUBLIC_UI_V2=false</code> in Netlify env to fall
        back. Error has been logged.
      </p>
      {error.digest && (
        <p className="text-xs text-text-muted">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-8 w-fit items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        Retry
      </button>
    </div>
  );
}
