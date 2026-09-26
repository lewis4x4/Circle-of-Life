"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FAMILY_VISITS_DESCRIPTION,
  FAMILY_VISITS_EMPTY,
  FAMILY_VISITS_LOADING,
  FAMILY_VISITS_NOT_SHARED,
  FAMILY_VISITS_TITLE,
} from "@/lib/family/family-portal-copy";
import { fetchFamilyResidentVisits, familyVisitTitle, familyVisitWhen, type FamilyVisitsResult } from "@/lib/family/family-visits-data";
import type { Database } from "@/types/database";

type VisitsState = { status: "loading" } | FamilyVisitsResult;

/** The Visits list on the family Updates page (COL-871). */
export function FamilyResidentVisits({ supabase, residentId }: { supabase: SupabaseClient<Database>; residentId: string }) {
  const [state, setState] = useState<VisitsState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetchFamilyResidentVisits(supabase, residentId)
      .then(setState)
      .catch(() => setState({ ok: false, error: "Visits could not be loaded right now." }));
  }, [supabase, residentId]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  return (
    <section aria-labelledby="family-visits-heading" className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 id="family-visits-heading" className="text-base font-medium text-foreground">
          {FAMILY_VISITS_TITLE}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{FAMILY_VISITS_DESCRIPTION}</p>
      </header>
      <div className="px-4 py-3">
        {"status" in state ? (
          <p role="status" className="text-sm text-muted-foreground">
            {FAMILY_VISITS_LOADING}
          </p>
        ) : !state.ok ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
            <button
              type="button"
              onClick={load}
              className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Try again
            </button>
          </div>
        ) : state.sharing === "off" ? (
          <p className="text-sm text-muted-foreground">{FAMILY_VISITS_NOT_SHARED}</p>
        ) : state.visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{FAMILY_VISITS_EMPTY}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Visits, newest first">
            {state.visits.map((visit) => (
              <li key={visit.id} className="flex flex-col gap-0.5 py-2.5">
                <span className="text-sm font-medium text-foreground">{familyVisitTitle(visit)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{familyVisitWhen(visit)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
