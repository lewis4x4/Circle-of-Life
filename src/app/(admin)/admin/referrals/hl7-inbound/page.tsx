"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Radio } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Row = Database["public"]["Tables"]["referral_hl7_inbound"]["Row"];
type Status = Database["public"]["Enums"]["referral_hl7_inbound_status"];

function previewRaw(s: string) {
  const t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminReferralsHl7InboundPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("referral_hl7_inbound")
        .select("*")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(75);
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load HL7 queue.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: Status) {
    setUpdatingId(id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: uErr } = await supabase
        .from("referral_hl7_inbound")
        .update({ status, updated_by: user.id })
        .eq("id", id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUpdatingId(null);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          HL7 inbound
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Raw ADT-style messages queued for the selected facility. Parsing and auto-lead creation are Enhanced.
        </p>
      </div>

      <ReferralsHubNav />

      {noFacility ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header to load the queue.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href="/admin/referrals/hl7-inbound/new"
          className={cn(buttonVariants({ variant: "default" }), "inline-flex items-center gap-2")}
        >
          <Radio className="h-4 w-4" aria-hidden />
          Ingest message
        </Link>
      </div>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg">Queue</CardTitle>
          <CardDescription>Most recent messages first. Use actions to triage without a full parser.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : noFacility ? null : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No HL7 messages yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Control ID</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="max-w-[220px]">Preview</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(row.created_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.message_control_id ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.trigger_event ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-slate-600 dark:text-slate-300">
                      {previewRaw(row.raw_message)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                          disabled={updatingId === row.id}
                          onClick={() => void setStatus(row.id, "processed")}
                        >
                          Processed
                        </button>
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                          disabled={updatingId === row.id}
                          onClick={() => void setStatus(row.id, "failed")}
                        >
                          Failed
                        </button>
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 text-xs")}
                          disabled={updatingId === row.id}
                          onClick={() => void setStatus(row.id, "ignored")}
                        >
                          Ignore
                        </button>
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
