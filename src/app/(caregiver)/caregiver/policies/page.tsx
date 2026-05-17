"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";
import { fetchPendingPoliciesForUser, resolveAckFacilityId } from "@/lib/pending-policies";
import type { PendingPolicySummary } from "@/lib/pending-policies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CaregiverSupportStrip } from "@/components/caregiver/CaregiverSupportStrip";

export default function CaregiverPendingPoliciesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PendingPolicySummary[]>([]);
  const [homeHref, setHomeHref] = useState("/caregiver");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRows([]);
        return;
      }
      setHomeHref(getDashboardRouteForRole(getAppRoleFromClaims(user)));
      const facId = await resolveAckFacilityId(supabase, user.id);
      if (!facId) {
        setRows([]);
        return;
      }
      const pending = await fetchPendingPoliciesForUser(supabase, user.id, facId);
      setRows(pending);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <CaregiverSupportStrip
        active="policies"
        title="Keep required acknowledgments close to the rest of your shift support tools."
        description="Review policy tasks here, then return to your profile, schedule, or the active shift once you are caught up."
      />
      <div>
        <Link
          href="/caregiver/me"
          className="inline-flex min-h-[44px] items-center text-sm text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        >
          ← Me
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Policies to acknowledge</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read and confirm each policy required for your facility.
        </p>
      </div>

      <Link
        href={homeHref}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-auto min-h-[44px] w-full border-border bg-card text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        )}
      >
        Back to shift home
      </Link>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-border bg-card text-card-foreground">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You are caught up. No pending policies.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="border-border bg-card text-card-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-5 w-5 text-warning" />
                    <div>
                      <CardTitle className="text-base">{r.title}</CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {r.category.replace(/_/g, " ")}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/caregiver/policies/${r.id}`}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "h-auto min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                    )}
                  >
                    Review &amp; acknowledge
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
