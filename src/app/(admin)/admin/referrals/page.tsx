"use client";

import Link from "next/link";
import { ClipboardList, GitMerge, Phone, UserPlus } from "lucide-react";

import { ReferralsHubNav } from "./referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function AdminReferralsHubPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Referrals
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Inquiries and pipeline before admission — source attribution, status, and conversion to residents.
        </p>
      </div>

      <ReferralsHubNav />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">New</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">—</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Active pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">—</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Converted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">—</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">—</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/referrals/new" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <UserPlus className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  New lead
                </CardTitle>
                <p className="text-xs text-slate-600 dark:text-slate-300">Manual entry (database wiring in Phase 4 migrations)</p>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/referrals/sources" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <Phone className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  Referral sources
                </CardTitle>
                <p className="text-xs text-slate-600 dark:text-slate-300">Hospitals, agencies, web, and other channels</p>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
        <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
        <span>
          Duplicate merge and status transitions will follow org policy; merge is restricted to owner / org admin by default (
          <span className="whitespace-nowrap">spec: `01-referral-inquiry.md`</span>).
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ClipboardList className="h-4 w-4 shrink-0" />
          Pipeline leads
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                  No leads yet. After migrations <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">075</code>–
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">076</code>, this list will load from{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">referral_leads</code>.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>Admissions start from a lead or a resident record:</span>
        <Link href="/admin/residents/new" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          New resident
        </Link>
      </div>
    </div>
  );
}
