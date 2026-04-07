"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";

type LiveTaskRow = {
  id: string;
  due_at: string;
  derived_status: string;
  residents?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  staff?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  shift_assignments?: { shift_type: string | null } | null;
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

export default function AdminRoundingLivePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<LiveTaskRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/rounding/tasks?facilityId=${encodeURIComponent(selectedFacilityId)}&limit=200`, {
        cache: "no-store",
      });
      const json = (await response.json()) as { error?: string; tasks?: LiveTaskRow[] };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load live board");
      }
      setTasks(json.tasks ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load live board.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          (new Date(a.due_at).getTime() || 0) - (new Date(b.due_at).getTime() || 0),
      ),
    [tasks],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Live rounding board</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Due, overdue, and completed checks by resident, shift, and assigned staff member.</p>
      </div>

      <RoundingHubNav />

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button onClick={() => void load()}>Refresh board</Button>
      </div>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle>Current queue</CardTitle>
          <CardDescription>{selectedFacilityId ? "Facility-scoped live board." : "Select a facility in the header to load the board."}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Resident</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!selectedFacilityId ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      Select a facility to load the live board.
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      No rounding tasks found for the current scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{displayName(task.residents) || "Resident"}</TableCell>
                      <TableCell>{new Date(task.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                      <TableCell>{task.shift_assignments?.shift_type ?? "—"}</TableCell>
                      <TableCell>{displayName(task.staff) || "Unassigned"}</TableCell>
                      <TableCell>
                        <Badge variant={task.derived_status.includes("overdue") || task.derived_status.includes("missed") ? "destructive" : "outline"}>
                          {task.derived_status.replaceAll("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
