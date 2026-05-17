"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

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
      supabase
        .from("outbreak_actions")
        .select("*")
        .eq("outbreak_id", id)
        .is("deleted_at", null)
        .order("sort_order"),
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
      <RecordDetailHeader
        title={out ? String(out.infection_type) : "Outbreak"}
        subtitle={
          out
            ? `Status: ${String(out.status)} · Cases: ${String(out.total_cases ?? "—")}`
            : undefined
        }
        backLink={{ label: "Infection control", href: "/admin/infection-control" }}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <RecordDetailSection title="Action checklist">
        <div className="text-sm">
          {actions.length === 0 ? (
            <p className="text-muted-foreground">No actions loaded.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1">
              {actions.map((x) => (
                <li key={String(x.id)}>
                  {String(x.title)} —{" "}
                  <span className="text-muted-foreground">{String(x.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RecordDetailSection>
    </div>
  );
}
