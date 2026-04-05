"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Phone } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../billing-hub-nav";

type CollectionRow = {
  id: string;
  activity_type: string;
  activity_date: string;
  description: string;
  outcome: string | null;
  follow_up_date: string | null;
  follow_up_notes: string | null;
  resident_id: string;
  invoice_id: string | null;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export default function AdminCollectionsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility to view collection activities.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const res = await supabase
        .from("collection_activities")
        .select(
          "id, activity_type, activity_date, description, outcome, follow_up_date, follow_up_notes, resident_id, invoice_id, residents(first_name, last_name)",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("activity_date", { ascending: false })
        .limit(200);
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as CollectionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load collections.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <BillingHubNav />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Collections
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Ledger of follow-up calls, letters, promises, and escalations for past-due balances.
          </p>
        </div>
        <Link
          href="/admin/billing/collections/new"
          className={buttonVariants({ size: "sm" })}
        >
          Log activity
        </Link>
      </div>

      {error && (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Phone className="h-5 w-5 text-slate-500" />
          <div>
            <CardTitle className="text-lg">Activity log</CardTitle>
            <CardDescription>Scoped to the selected facility.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <AdminTableLoadingState />
          ) : rows.length === 0 && !error ? (
            <AdminEmptyState
              title="No collection activities"
              description="Log phone calls, promises, or escalations when working past-due accounts."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const name =
                    `${r.residents?.last_name ?? ""}, ${r.residents?.first_name ?? ""}`.replace(
                      /^, |, $/,
                      "",
                    ) || "—";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">{r.activity_date}</TableCell>
                      <TableCell className="text-sm">{r.activity_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm">{name}</TableCell>
                      <TableCell className="max-w-md truncate text-sm text-slate-600 dark:text-slate-400">
                        {r.description}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {r.follow_up_date ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-slate-600 dark:text-slate-400">
                        {r.outcome ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
