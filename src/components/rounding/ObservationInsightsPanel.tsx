"use client";

/**
 * AI safety insights, folded into Reports. Spec 25A defect 9.
 *
 * Insights was a destination tab of its own. It is a feed an administrator
 * reads periodically rather than a place work happens, so it belongs beside
 * the other periodic reads.
 *
 * Nothing here renders a number about a resident. Spec section 7.7 is explicit:
 * "No AI-derived number renders on a resident row under any circumstance." The
 * insight carries a severity, which is a word, and a title the model wrote. The
 * model name is not rendered either: it is an internal identifier, and defect 3
 * keeps those off operator surfaces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw } from "lucide-react";

import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { formatEscalationTimestamp } from "@/lib/rounding/rounding-timestamps";
import { logRoundingQueryFailure } from "@/lib/rounding/rounding-query-error";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type InsightRow = {
  id: string;
  resident_id: string;
  insight_type: string;
  severity: string;
  title: string;
  body: string | null;
  status: string;
  created_at: string;
  residents: { first_name: string | null; last_name: string | null } | null;
};

const SELECT =
  "id, resident_id, insight_type, severity, title, body, status, created_at, residents(first_name, last_name)";

const LOAD_FAILED = "Insights could not be loaded. Retry, or try again in a moment.";

const SEVERITY_TONE: Record<string, StatusPillTone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "muted",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** An insight is open until somebody has looked at it. */
const OPEN_STATUSES = ["new", "acknowledged"] as const;

export function ObservationInsightsPanel({ facilityId }: { facilityId: string | null }) {
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("resident_safety_insights")
        .select(SELECT)
        .eq("facility_id", facilityId)
        .in("status", OPEN_STATUSES)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      setRows((data ?? []) as unknown as InsightRow[]);
    } catch (queryError) {
      setError(logRoundingQueryFailure("rounding.insights.load", queryError, LOAD_FAILED));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [facilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    async (id: string, status: "acknowledged" | "dismissed") => {
      const { error: updateError } = await supabase
        .from("resident_safety_insights")
        .update({
          status,
          ...(status === "acknowledged" ? { acknowledged_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
      if (updateError) {
        setError(
          logRoundingQueryFailure(
            "rounding.insights.update",
            updateError,
            "That insight could not be updated. Retry, or try again in a moment.",
          ),
        );
        return;
      }
      await load();
    },
    [load, supabase],
  );

  if (!facilityId) return null;

  return (
    <section aria-label="Safety insights" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Safety insights</h2>
          <p className="text-[12px] text-muted-foreground">
            Patterns the model raised from this building&apos;s records. A reading, not a finding,
            and never a number about a resident.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          aria-label="Refresh safety insights"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
        </Button>
      </div>

      {error ? <RoundingErrorNotice message={error} onRetry={() => void load()} /> : null}

      {rows.length === 0 ? (
        <RoundingEmptyNotice
          label="No open safety insights"
          copy={
            loading
              ? { why: "Loading insights.", guidance: "This building's open insights are on their way." }
              : {
                  why: "No open safety insights at this building.",
                  guidance:
                    "An insight appears here when the scheduled analysis finds a pattern in the observation record, and leaves once somebody has acted on it.",
                }
          }
        />
      ) : (
        <ul className="space-y-2" aria-label="Open safety insights">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={SEVERITY_TONE[row.severity] ?? "muted"}>
                      {SEVERITY_LABEL[row.severity] ?? "No severity posted"}
                    </StatusPill>
                    <span className="text-[13px] font-semibold text-foreground">{row.title}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {[row.residents?.first_name, row.residents?.last_name]
                      .filter(Boolean)
                      .join(" ") || "No resident posted"}
                    <span aria-hidden className="px-1.5 text-border">
                      ·
                    </span>
                    {formatEscalationTimestamp(row.created_at)}
                  </p>
                  {row.body ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground">{row.body}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {row.status === "new" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void setStatus(row.id, "acknowledged")}
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void setStatus(row.id, "dismissed")}
                  >
                    Not useful
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
