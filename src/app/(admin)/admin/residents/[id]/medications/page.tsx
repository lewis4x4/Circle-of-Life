"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pill } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Med = {
  id: string;
  medication_name: string;
  strength: string | null;
  route: string;
  frequency: string;
  scheduled_times: string[] | null;
  status: string;
  prescriber_name: string | null;
  start_date: string;
  controlled_schedule: string;
};

export default function AdminResidentMedicationsPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"active" | "discontinued" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [residentName, setResidentName] = useState<string>("");
  const [rows, setRows] = useState<Med[]>([]);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await supabase
        .from("residents")
        .select("first_name, last_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (r.data) {
        setResidentName([r.data.first_name, r.data.last_name].filter(Boolean).join(" ") || "Resident");
      }

      const q = supabase
        .from("resident_medications")
        .select(
          "id, medication_name, strength, route, frequency, scheduled_times, status, prescriber_name, start_date, controlled_schedule",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("medication_name");

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as Med[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load medications");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "active") return rows.filter((m) => m.status === "active");
    return rows.filter((m) => m.status === "discontinued");
  }, [rows, tab]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/admin/residents/${residentId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0")}
          >
            <ArrowLeft className="h-4 w-4" />
            Resident
          </Link>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
            <Pill className="h-6 w-6 text-brand-600" />
            Medications · {residentName || "…"}
          </h1>
        </div>
        <Link
          href="/admin/medications/verbal-orders/new"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
        >
          New verbal order
        </Link>
      </div>

      <div className="flex gap-2">
        {(["active", "discontinued", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize",
              tab === t
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="font-display text-lg">Medication list</CardTitle>
            <CardDescription>Active orders and controlled schedule flags</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 sm:p-2">
            {filtered.length === 0 ? (
              <p className="px-6 py-4 text-sm text-slate-500">No medications in this filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medication</TableHead>
                    <TableHead>Strength / form</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Controlled</TableHead>
                    <TableHead>Prescriber</TableHead>
                    <TableHead>Start</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.medication_name}</TableCell>
                      <TableCell className="text-xs text-slate-600">{m.strength ?? "—"}</TableCell>
                      <TableCell className="capitalize">{m.route.replace(/_/g, " ")}</TableCell>
                      <TableCell className="max-w-[140px] text-xs">
                        {m.frequency.replace(/_/g, " ")}
                        {m.scheduled_times?.length
                          ? ` · ${m.scheduled_times.join(", ")}`
                          : ""}
                      </TableCell>
                      <TableCell>
                        {m.controlled_schedule === "non_controlled" ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <Badge variant="outline" className="uppercase">
                            {m.controlled_schedule}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{m.prescriber_name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{m.start_date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
