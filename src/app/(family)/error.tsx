"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button, buttonVariants } from "@/components/ui/button";
import { CriticalAlertBanner } from "@/design-system/components/critical-alert";
import { cn } from "@/lib/utils";

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
      <div className="mx-auto w-full max-w-md">
        <CriticalAlertBanner
          title="Unable to load this page"
          description="The page did not finish loading. Try refreshing or return home. Contact support if the issue persists."
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          reference={error.digest}
          actions={
            <>
              <Button onClick={reset} variant="default">
                Retry
              </Button>
              <Link
                href="/family"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Home
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
