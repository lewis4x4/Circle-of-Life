"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button, buttonVariants } from "@/components/ui/button";
import { CriticalAlertBanner } from "@/design-system/components/critical-alert";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [homeHref, setHomeHref] = useState("/admin");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user) {
        setHomeHref(getDashboardRouteForRole(getAppRoleFromClaims(user)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="mx-auto w-full max-w-md">
        <CriticalAlertBanner
          title="Unable to load this page"
          description="The section did not finish loading. Try refreshing or return to the dashboard. Contact support if the issue persists."
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          reference={error.digest}
          actions={
            <>
              <Button onClick={reset} variant="default">
                Retry
              </Button>
              <Link
                href={homeHref}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Dashboard
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
