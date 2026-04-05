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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  title: string;
  category: string;
  version: number;
  status: string;
  published_at: string | null;
};

export default function PoliciesListPage() {
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
        .from("policy_documents")
        .select("id, title, category, version, status, published_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (!error && data) setRows(data as Row[]);
      else setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin/compliance" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
            ← Compliance
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">Policy library</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Versioned policies and acknowledgment tracking.</p>
        </div>
        <Link href="/admin/compliance/policies/new" className={cn(buttonVariants({ size: "sm" }))}>
          New policy
        </Link>
      </div>

      {!ready ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select a facility</CardTitle>
            <CardDescription>Policies are managed per facility.</CardDescription>
          </CardHeader>
        </Card>
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">No policies yet.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell>v{r.version}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "published" ? "default" : "secondary"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/compliance/policies/${r.id}/edit`}
                        className={cn(buttonVariants({ variant: "link", size: "sm" }))}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
