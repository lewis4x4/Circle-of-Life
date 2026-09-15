"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileStack, Loader2, RefreshCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/client";

import { humanizeToken } from "./ui-labels";

type IntakeLinkRow = {
  id: string;
  title: string;
  state: string;
  updated_at: string;
};

type UntypedIntakeQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  select: (columns: string) => UntypedIntakeQuery;
  is: (column: string, value: null) => UntypedIntakeQuery;
  or: (filters: string) => UntypedIntakeQuery;
  order: (column: string, options: { ascending: boolean }) => UntypedIntakeQuery;
  limit: (count: number) => UntypedIntakeQuery;
};

type UntypedIntakeClient = { from: (table: string) => UntypedIntakeQuery };

export type ResidentIntakeLinksProps = {
  admissionCaseId?: string | null;
  residentId?: string | null;
  compact?: boolean;
};

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update time not posted";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function stateTone(state: string): "muted" | "success" | "warning" | "danger" | "info" {
  if (state === "complete") return "success";
  if (["cancelled", "failed"].includes(state)) return "danger";
  if (["match_required", "partially_applied"].includes(state)) return "warning";
  if (["review", "ready_to_parse", "parsing"].includes(state)) return "info";
  return "muted";
}

export function ResidentIntakeLinks({ admissionCaseId = null, residentId = null, compact = false }: ResidentIntakeLinksProps) {
  const [state, setState] = useState<"loading" | "error" | "empty" | "populated">("loading");
  const [items, setItems] = useState<IntakeLinkRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admissionCaseId && !residentId) {
      setItems([]);
      setState("empty");
      return;
    }
    setState("loading");
    setMessage(null);
    const client = createClient() as unknown as UntypedIntakeClient;
    const filters = [
      admissionCaseId ? `admission_case_id.eq.${admissionCaseId}` : null,
      residentId ? `resident_id.eq.${residentId}` : null,
    ].filter((value): value is string => Boolean(value)).join(",");
    try {
      const { data, error } = await client
        .from("resident_record_intakes")
        .select("id,title,state,updated_at")
        .is("deleted_at", null)
        .or(filters)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      const next = (data ?? []).filter((item): item is IntakeLinkRow => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<IntakeLinkRow>;
        return typeof row.id === "string" && typeof row.title === "string" && typeof row.state === "string" && typeof row.updated_at === "string";
      });
      setItems(next);
      setState(next.length ? "populated" : "empty");
    } catch {
      setItems([]);
      setMessage("Packet reviews could not be loaded. Try again without leaving this page.");
      setState("error");
    }
  }, [admissionCaseId, residentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const createParams = new URLSearchParams({ tab: "packet" });
  if (admissionCaseId) createParams.set("case", admissionCaseId);
  if (residentId) createParams.set("resident", residentId);
  const createHref = `/admin/admissions/new?${createParams.toString()}`;

  if (state === "loading") return <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />Loading packet reviews…</div>;
  if (state === "error") return <div className="space-y-3"><p role="alert" className="text-[12px] text-destructive">{message}</p><Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCcw className="mr-1.5 size-3.5" aria-hidden />Try again</Button></div>;

  return (
    <div className="space-y-3">
      {state === "empty" ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <FileStack className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-[13px] font-medium text-foreground">No packet reviews yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Upload admission documents to build a reviewed resident record.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/admin/admissions/intake/${item.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="min-w-0"><p className="truncate text-[13px] font-medium text-foreground">{item.title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Updated {dateLabel(item.updated_at)}</p></div>
                <StatusPill tone={stateTone(item.state)}>{humanizeToken(item.state)}</StatusPill>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={createHref} className={buttonVariants({ variant: compact ? "ghost" : "outline", size: "sm" })}>Upload another packet</Link>
    </div>
  );
}
