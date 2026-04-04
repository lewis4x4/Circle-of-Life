"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
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

export default function ResidentVitalsPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = createClient();
  const [logs, setLogs] = useState<
    {
      id: string;
      log_date: string;
      shift: string;
      temperature: number | null;
      blood_pressure_systolic: number | null;
      blood_pressure_diastolic: number | null;
      pulse: number | null;
      respiration: number | null;
      oxygen_saturation: number | null;
      weight_lbs: number | null;
    }[]
  >([]);
  const [alerts, setAlerts] = useState<{ id: string; vital_type: string; status: string; created_at: string }[]>([]);

  const load = useCallback(async () => {
    const [daily, va] = await Promise.all([
      supabase
        .from("daily_logs")
        .select(
          "id, log_date, shift, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, respiration, oxygen_saturation, weight_lbs",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("log_date", { ascending: false })
        .limit(30),
      supabase
        .from("vital_sign_alerts")
        .select("id, vital_type, status, created_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setLogs((daily.data ?? []) as never);
    setAlerts((va.data ?? []) as never);
  }, [supabase, residentId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={`/admin/residents/${residentId}`} className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
            ← Resident
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Vitals</h1>
        </div>
        <Link href={`/admin/residents/${residentId}/vitals/thresholds`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Alert thresholds
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent daily logs</CardTitle>
          <CardDescription>Temperature, BP, pulse, respiration, O₂, weight</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>T</TableHead>
                <TableHead>BP</TableHead>
                <TableHead>Pulse</TableHead>
                <TableHead>RR</TableHead>
                <TableHead>O₂</TableHead>
                <TableHead>Wt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.log_date}</TableCell>
                  <TableCell>{r.shift}</TableCell>
                  <TableCell>{r.temperature ?? "—"}</TableCell>
                  <TableCell>
                    {r.blood_pressure_systolic ?? "—"}/{r.blood_pressure_diastolic ?? "—"}
                  </TableCell>
                  <TableCell>{r.pulse ?? "—"}</TableCell>
                  <TableCell>{r.respiration ?? "—"}</TableCell>
                  <TableCell>{r.oxygen_saturation ?? "—"}</TableCell>
                  <TableCell>{r.weight_lbs ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vital alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.id}>
                {a.vital_type} — {a.status} — {new Date(a.created_at).toLocaleString()}
              </li>
            ))}
            {alerts.length === 0 && <li className="text-slate-500">No alerts.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
