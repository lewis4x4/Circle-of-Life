"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function OutbreakDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const supabase = createClient();
  const [out, setOut] = useState<Record<string, unknown> | null>(null);
  const [actions, setActions] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [o, a] = await Promise.all([
      supabase.from("infection_outbreaks").select("*").eq("id", id).maybeSingle(),
      supabase.from("outbreak_actions").select("*").eq("outbreak_id", id).is("deleted_at", null).order("sort_order"),
    ]);
    if (o.error) {
      setError(o.error.message);
      return;
    }
    setOut(o.data as Record<string, unknown>);
    if (a.error) setActions([]);
    else setActions((a.data ?? []) as Record<string, unknown>[]);
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
      <h1 className="font-display text-2xl font-semibold tracking-tight">Outbreak</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {out && (
        <Card>
          <CardHeader>
            <CardTitle>{String(out.infection_type)}</CardTitle>
            <CardDescription>Status: {String(out.status)} · Cases: {String(out.total_cases ?? "—")}</CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Action checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {actions.length === 0 ? (
            <p className="text-slate-500">No actions loaded.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1">
              {actions.map((x) => (
                <li key={String(x.id)}>
                  {String(x.title)} — <span className="text-slate-500">{String(x.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
