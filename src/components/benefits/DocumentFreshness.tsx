"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { BenefitsDetail, DocumentFreshness as FreshnessData, DocumentFreshnessItem } from "@/lib/benefits/contracts";
import { benefitsFetch, ErrorNotice, Panel } from "./benefits-ui";

const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (value: string) => longDate.format(new Date(`${value}T00:00:00Z`));

export function freshnessLabel(item: Pick<DocumentFreshnessItem, "freshness" | "expires_on" | "days_left">) {
  if (item.freshness === "expired") return `Expired ${day(item.expires_on)}`;
  if (item.freshness === "expiring") return `Expires ${day(item.expires_on)} (${item.days_left} day${item.days_left === 1 ? "" : "s"})`;
  return `Good until ${day(item.expires_on)}`;
}

/** COL-768: accepted documents with a good-for period; expiring and expired ones are reopened for the facility administrator. */
export function DocumentFreshness({ detail, onChanged }: { detail: BenefitsDetail; onChanged: () => void | Promise<void> }) {
  const [data, setData] = useState<FreshnessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const attempt = useRef<{ requirementId: string; requestId: string } | null>(null);
  const base = `/api/admin/benefits/cases/${detail.case.id}/freshness`;
  const load = useCallback(async () => {
    try { setData(await benefitsFetch<FreshnessData>(base)); setError(null); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : "Could not load document dates."); }
  }, [base]);
  useEffect(() => { void load(); }, [load, detail.case.revision]);
  if (!data && !error) return null;
  if (data && data.items.length === 0) return null;
  const reopen = async (item: DocumentFreshnessItem) => {
    if (!data || busy) return;
    if (attempt.current?.requirementId !== item.requirement_id) attempt.current = { requirementId: item.requirement_id, requestId: crypto.randomUUID() };
    setBusy(item.requirement_id); setError(null);
    try {
      await benefitsFetch(base, { method: "POST", body: JSON.stringify({ request_id: attempt.current.requestId, requirement_id: item.requirement_id, expected_revision: data.revision }) });
      attempt.current = null;
      await onChanged(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reopen the document."); }
    finally { setBusy(null); }
  };
  const stale = data?.items.filter((item) => item.freshness !== "fresh") ?? [];
  return (
    <Panel title="Document dates" description="Some documents are only good for a period after they are accepted (set under Medicaid & benefits → Rules). Reopen an expiring one so the facility administrator gathers a current copy.">
      <ErrorNotice error={error} />
      {data && (
        <>
          <ul className="divide-y">
            {data.items.map((item) => (
              <li key={item.requirement_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="space-y-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">Accepted {day(item.accepted_on)} · good for {item.valid_days} days</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={item.freshness === "fresh" ? "muted" : item.freshness === "expired" ? "danger" : "warning"}>{freshnessLabel(item)}</StatusPill>
                  {item.freshness !== "fresh" && data.can_write && (
                    <Button type="button" variant="outline" className="min-h-11" disabled={!!busy} onClick={() => void reopen(item)}>
                      {busy === item.requirement_id ? "Reopening…" : "Reopen to gather a current copy"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {stale.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {data.family_can_collect
                ? "A linked family member with financial access can be asked for the new copy: reopen it, then assign it under Family document collection."
                : "No linked family member has current financial access, so the facility administrator gathers it."}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
