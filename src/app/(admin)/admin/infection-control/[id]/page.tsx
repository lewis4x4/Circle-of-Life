"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function InfectionSurveillanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const supabase = createClient();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: qErr } = await supabase.from("infection_surveillance").select("*").eq("id", id).maybeSingle();
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setRow(data as Record<string, unknown>);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/admin/infection-control" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
        ← Infection control
      </Link>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Surveillance record</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {row && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>ID: {String(row.id)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Type:</span> {String(row.infection_type)}
            </p>
            <p>
              <span className="text-slate-500">Status:</span> {String(row.status)}
            </p>
            <p>
              <span className="text-slate-500">Onset:</span> {String(row.onset_date)}
            </p>
            {row.outbreak_id ? (
              <p>
                <span className="text-slate-500">Outbreak:</span>{" "}
                <Link
                  href={`/admin/infection-control/outbreaks/${String(row.outbreak_id)}`}
                  className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0")}
                >
                  View
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
