"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchExecutiveAlerts, acknowledgeExecutiveAlert, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { cn } from "@/lib/utils";

function severityBadgeVariant(
  s: ExecutiveAlertRow["severity"],
): "destructive" | "secondary" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

export default function ExecutiveAlertsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ExecutiveAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        return;
      }
      const data = await fetchExecutiveAlerts(supabase, ctx.ctx.organizationId, selectedFacilityId, 100);
      setRows(data);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Unable to load alerts.");
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAck(alert: ExecutiveAlertRow) {
    setBusyId(alert.id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in required.");
        return;
      }
      await acknowledgeExecutiveAlert(supabase, alert.id, user.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex items-center gap-3">
        <Bell className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Executive alerts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Open alerts from Module 24. Acknowledging records who saw the item; resolve in source workflows where applicable.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>Unresolved alerts for your scope (org or selected facility).</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No open alerts.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant={severityBadgeVariant(a.severity)}>{a.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{a.source_module.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{a.title}</div>
                      {a.body && <div className="text-sm text-slate-600 dark:text-slate-400">{a.body}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {a.deep_link_path && (
                          <Link
                            href={a.deep_link_path}
                            className={cn(
                              "text-sm text-primary underline-offset-4 hover:underline",
                            )}
                          >
                            Open
                          </Link>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busyId === a.id || !!a.acknowledged_at}
                          onClick={() => void onAck(a)}
                        >
                          {a.acknowledged_at ? "Acknowledged" : busyId === a.id ? "…" : "Acknowledge"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
