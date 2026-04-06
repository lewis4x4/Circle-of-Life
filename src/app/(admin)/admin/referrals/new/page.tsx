"use client";

import Link from "next/link";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function AdminReferralsNewPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            New referral lead
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Capture inquiry details before a full resident record exists.
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Lead form</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Placeholder layout — persisting to <code className="text-xs">referral_leads</code> ships with migrations{" "}
            <code className="text-xs">075</code>–<code className="text-xs">076</code> and typed Supabase access.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="ref-first" className="text-sm font-medium leading-none text-slate-900 dark:text-slate-100">
                First name
              </label>
              <Input id="ref-first" disabled readOnly placeholder="—" className="bg-slate-50 dark:bg-slate-900/50" />
            </div>
            <div className="space-y-2">
              <label htmlFor="ref-last" className="text-sm font-medium leading-none text-slate-900 dark:text-slate-100">
                Last name
              </label>
              <Input id="ref-last" disabled readOnly placeholder="—" className="bg-slate-50 dark:bg-slate-900/50" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Facility</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Uses the facility selector in the admin shell (same scope as other modules).</p>
          </div>
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            Minimum-necessary fields and <code className="text-xs">pii_access_tier</code> are enforced in API + RLS — see spec
            <code className="ml-1 text-xs">01-referral-inquiry.md</code>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
