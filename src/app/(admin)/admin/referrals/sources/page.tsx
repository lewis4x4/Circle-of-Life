"use client";

import Link from "next/link";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function AdminReferralSourcesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Referral sources
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Master list for attribution (hospital, agency, family, web, other). Ties to{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">residents.referral_source_id</code> when set.
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Sources</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            CRUD for <code className="text-xs">referral_sources</code> lands with the same migration segment as leads.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No sources yet. Org-wide vs facility-scoped sources will appear here after migration{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">075</code>.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
