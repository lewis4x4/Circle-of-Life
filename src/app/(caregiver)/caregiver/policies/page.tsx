"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { fetchPendingPoliciesForUser, resolveAckFacilityId } from "@/lib/pending-policies";
import type { PendingPolicySummary } from "@/lib/pending-policies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CaregiverPendingPoliciesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PendingPolicySummary[]>([]);

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
      <div>
        <Link href="/caregiver/me" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Me
        </Link>
        <h1 className="mt-2 font-display text-xl font-semibold text-zinc-100">Policies to acknowledge</h1>
        <p className="mt-1 text-sm text-zinc-400">Read and confirm each policy required for your facility.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">You are caught up. No pending policies.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-5 w-5 text-amber-500" />
                    <div>
                      <CardTitle className="text-base">{r.title}</CardTitle>
                      <CardDescription className="text-zinc-500">{r.category.replace(/_/g, " ")}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/caregiver/policies/${r.id}`}
                    className={cn(buttonVariants({ size: "sm" }), "bg-amber-700 hover:bg-amber-600")}
                  >
                    Review & acknowledge
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
