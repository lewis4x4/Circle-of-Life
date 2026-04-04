"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  staff_id: string;
  reported_date: string;
  illness_type: string;
  absent_from: string;
  absent_to: string | null;
  return_cleared: boolean;
};

export default function StaffIllnessListPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("staff_illness_records")
        .select("id, staff_id, reported_date, illness_type, absent_from, absent_to, return_cleared")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("reported_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/admin/infection-control" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          ← Infection control
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Staff illness</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Recent records for the selected facility.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} shown`}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reported</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Absent</TableHead>
                <TableHead>Cleared</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.reported_date}</TableCell>
                  <TableCell>{r.illness_type}</TableCell>
                  <TableCell>
                    {r.absent_from}
                    {r.absent_to ? ` → ${r.absent_to}` : " → still out"}
                  </TableCell>
                  <TableCell>{r.return_cleared ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
