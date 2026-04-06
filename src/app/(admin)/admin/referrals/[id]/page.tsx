"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function AdminReferralLeadDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <Link href="/admin/referrals" className="hover:text-brand-600 dark:hover:text-brand-400">
              Referrals
            </Link>{" "}
            / Lead
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Lead detail
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Review status, source, conversion, and merge history (wired after Phase 4 schema).
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Lead ID</CardTitle>
          <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-300">{id || "—"}</p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>
            This route exercises dynamic segments for design review and accessibility gates. Loading{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">referral_leads</code> by id will
            replace this placeholder.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
