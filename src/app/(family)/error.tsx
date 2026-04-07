"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function FamilyError({
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
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Page error
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Something went wrong. Your information is safe — please try again.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-slate-400">
            Ref: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Try again
          </button>
          <Link
            href="/family"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
