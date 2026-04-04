"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  resident_id: string;
  facility_id: string;
  order_text: string;
  prescriber_name: string;
  received_at: string;
  cosignature_due_at: string;
  cosignature_status: string;
  implemented: boolean;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export default function AdminVerbalOrdersPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility to view verbal orders.");
      return;
    }
    try {
      const q = supabase
        .from("verbal_orders")
        .select(
          `
          id,
          resident_id,
          facility_id,
          order_text,
          prescriber_name,
          received_at,
          cosignature_due_at,
          cosignature_status,
          implemented,
          residents ( first_name, last_name )
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("received_at", { ascending: false })
        .limit(200);

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load verbal orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0")}
          >
            <ArrowLeft className="h-4 w-4" />
            Medications
          </Link>
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Verbal orders
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Co-signature tracking and implementation status (nurse+).
          </p>
        </div>
        <Link href="/admin/medications/verbal-orders/new" className={cn(buttonVariants(), "gap-2")}>
          <Plus className="h-4 w-4" />
          New verbal order
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      ) : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No verbal orders for this facility.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resident</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Prescriber</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Co-sig due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const name = r.residents
                  ? [r.residents.first_name, r.residents.last_name].filter(Boolean).join(" ")
                  : "—";
                const due = new Date(r.cosignature_due_at);
                const now = Date.now();
                const hoursLeft = (due.getTime() - now) / 36e5;
                let urgency: "ok" | "warn" | "bad" = "ok";
                if (r.cosignature_status === "expired") urgency = "bad";
                else if (hoursLeft <= 24) urgency = "warn";

                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-slate-600" title={r.order_text}>
                      {r.order_text}
                    </TableCell>
                    <TableCell>{r.prescriber_name}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {formatDistanceToNow(new Date(r.received_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.cosignature_status === "pending" ? (
                        <span
                          className={
                            urgency === "bad"
                              ? "text-red-600 dark:text-red-400"
                              : urgency === "warn"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {due.toLocaleString()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.cosignature_status}
                      </Badge>
                      {r.implemented ? (
                        <Badge variant="secondary" className="ml-1">
                          Implemented
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
