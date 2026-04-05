"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Supabase = ReturnType<typeof createClient>;

type ResidentPick = {
  id: string;
  first_name: string;
  last_name: string;
};

type ChartState = {
  carePlans: Array<{
    id: string;
    status: string;
    version: number;
    effective_date: string;
    review_due_date: string;
  }>;
  assessments: Array<{
    id: string;
    assessment_type: string;
    assessment_date: string;
    total_score: number | null;
    risk_level: string | null;
  }>;
  medications: Array<{
    id: string;
    medication_name: string;
    status: string;
    order_date: string;
    discontinued_date: string | null;
  }>;
  emarRecords: Array<{
    id: string;
    scheduled_time: string;
    status: string;
    is_prn: boolean;
  }>;
  dailyLogs: Array<{
    id: string;
    log_date: string;
    shift: string;
  }>;
  incidents: Array<{
    id: string;
    incident_number: string;
    occurred_at: string;
    category: string;
    severity: string;
    status: string;
  }>;
};

function sanitizeIlikeFragment(q: string): string {
  return q
    .replace(/[%_\\]/g, "\\$&")
    .replace(/,/g, " ")
    .trim()
    .slice(0, 80);
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysAgoIsoTimestamp(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

type SectionKey =
  | "care_plans"
  | "assessments"
  | "medications"
  | "emar"
  | "daily_logs"
  | "incidents";

export type SurveyVisitSearchOverlayProps = {
  supabase: Supabase;
  sessionId: string;
  facilityId: string;
  organizationId: string;
  userId: string;
};

export function SurveyVisitSearchOverlay({
  supabase,
  sessionId,
  facilityId,
  organizationId,
  userId,
}: SurveyVisitSearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matches, setMatches] = useState<ResidentPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResidentPick | null>(null);
  const [chart, setChart] = useState<ChartState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chartMs, setChartMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSections, setOpenSections] = useState<Partial<Record<SectionKey, boolean>>>({
    care_plans: true,
    assessments: true,
  });
  const [loggedChartFor, setLoggedChartFor] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = sanitizeIlikeFragment(debounced);
    if (q.length < 2) {
      setMatches([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const pattern = `%${q}%`;
    void (async () => {
      const { data, error } = await supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .in("status", ["active", "hospital_hold", "loa"])
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .order("last_name", { ascending: true })
        .limit(15);
      if (cancelled) return;
      setSearching(false);
      if (error) {
        setMatches([]);
        setSearchError(error.message);
        return;
      }
      setSearchError(null);
      setMatches((data ?? []) as ResidentPick[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, facilityId, supabase]);

  const residentLabel = useCallback((r: ResidentPick) => `${r.first_name} ${r.last_name}`.trim(), []);

  const logEntry = useCallback(
    async (recordType: string, recordId: string | null, description: string) => {
      const { error } = await supabase.from("survey_visit_log_entries").insert({
        session_id: sessionId,
        facility_id: facilityId,
        organization_id: organizationId,
        accessed_by: userId,
        record_type: recordType,
        record_id: recordId,
        record_description: description,
      });
      if (error) {
        console.warn("[survey-visit] log insert failed", error.message);
      }
    },
    [facilityId, organizationId, sessionId, supabase, userId],
  );

  const loadChart = useCallback(
    async (resident: ResidentPick) => {
      setLoadError(null);
      setChart(null);
      setChartMs(null);
      setLoggedChartFor(null);
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      const sinceTs = daysAgoIsoTimestamp(90);
      const sinceDate = daysAgoIsoDate(90);

      const [
        cpRes,
        asRes,
        medRes,
        emarRes,
        dlRes,
        incRes,
      ] = await Promise.all([
        supabase
          .from("care_plans")
          .select("id, status, version, effective_date, review_due_date")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("assessments")
          .select("id, assessment_type, assessment_date, total_score, risk_level")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .order("assessment_date", { ascending: false })
          .limit(50),
        supabase
          .from("resident_medications")
          .select("id, medication_name, status, order_date, discontinued_date")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .order("order_date", { ascending: false })
          .limit(100),
        supabase
          .from("emar_records")
          .select("id, scheduled_time, status, is_prn")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .gte("scheduled_time", sinceTs)
          .order("scheduled_time", { ascending: false })
          .limit(200),
        supabase
          .from("daily_logs")
          .select("id, log_date, shift")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .gte("log_date", sinceDate)
          .order("log_date", { ascending: false })
          .limit(90),
        supabase
          .from("incidents")
          .select("id, incident_number, occurred_at, category, severity, status")
          .eq("resident_id", resident.id)
          .is("deleted_at", null)
          .order("occurred_at", { ascending: false })
          .limit(25),
      ]);

      const errs = [cpRes.error, asRes.error, medRes.error, emarRes.error, dlRes.error, incRes.error].filter(
        Boolean,
      );
      if (errs.length) {
        const msg = errs.map((e) => e?.message).filter(Boolean).join("; ") || "Chart load failed";
        setLoadError(msg);
        return;
      }

      const elapsed =
        typeof performance !== "undefined" ? Math.round(performance.now() - t0) : 0;
      setChartMs(elapsed);
      if (process.env.NODE_ENV === "development") {
        console.info(`[survey-visit-chart] resident_id=${resident.id} load_ms=${elapsed}`);
      }

      setChart({
        carePlans: (cpRes.data ?? []) as ChartState["carePlans"],
        assessments: (asRes.data ?? []) as ChartState["assessments"],
        medications: (medRes.data ?? []) as ChartState["medications"],
        emarRecords: (emarRes.data ?? []) as ChartState["emarRecords"],
        dailyLogs: (dlRes.data ?? []) as ChartState["dailyLogs"],
        incidents: (incRes.data ?? []) as ChartState["incidents"],
      });

      const name = residentLabel(resident);
      await logEntry("resident_chart", resident.id, `Survey visit — full chart retrieved: ${name}`);
      setLoggedChartFor(resident.id);
    },
    [logEntry, residentLabel, supabase],
  );

  const onSelectResident = useCallback(
    (r: ResidentPick) => {
      setSelected(r);
      setQuery(residentLabel(r));
      setMatches([]);
      void loadChart(r);
    },
    [loadChart, residentLabel],
  );

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const logAssessmentRow = useCallback(
    async (a: ChartState["assessments"][0]) => {
      if (!selected) return;
      setBusy(true);
      try {
        await logEntry(
          "assessment",
          a.id,
          `Assessment ${a.assessment_type} (${a.assessment_date}) — ${selected.first_name} ${selected.last_name}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [logEntry, selected],
  );

  const sectionHeader = (key: SectionKey, title: string, count: number) => {
    const open = openSections[key] ?? false;
    return (
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100"
        onClick={() => toggleSection(key)}
      >
        <span>
          {title}{" "}
          <span className="text-slate-500 dark:text-slate-400">({count})</span>
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
    );
  };

  const detailHref = useMemo(() => {
    if (!selected) return null;
    return `/admin/residents/${selected.id}`;
  }, [selected]);

  return (
    <div className="relative z-20 mx-auto mt-3 max-w-6xl space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="survey-resident-search">
          Search resident (survey chart)
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="survey-resident-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected && e.target.value !== residentLabel(selected)) {
                setSelected(null);
                setChart(null);
                setChartMs(null);
                setLoggedChartFor(null);
              }
            }}
            placeholder="Type at least 2 characters…"
            className="pl-9 dark:bg-slate-900"
            autoComplete="off"
          />
          {searching ? (
            <p className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">Searching…</p>
          ) : null}
          {matches.length > 0 ? (
            <ul
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950"
              role="listbox"
            >
              {matches.map((r) => (
                <li key={r.id} role="option" aria-selected={selected?.id === r.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-900"
                    onClick={() => onSelectResident(r)}
                  >
                    {residentLabel(r)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {searchError ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {searchError}
          </p>
        ) : null}
      </div>

      {chartMs !== null ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Chart load: <strong>{chartMs} ms</strong>
          {chartMs > 3000 ? (
            <span className="ml-2 text-amber-700 dark:text-amber-400">(target under 3000 ms on local dev)</span>
          ) : (
            <span className="ml-2 text-emerald-700 dark:text-emerald-400">(under 3s target)</span>
          )}
        </p>
      ) : null}

      {loggedChartFor && selected?.id === loggedChartFor ? (
        <p className="text-xs text-slate-500">Logged survey access: resident chart (audit trail).</p>
      ) : null}

      {loadError ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      {selected && chart && detailHref ? (
        <Card className="border-amber-200/80 dark:border-amber-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Chart — {residentLabel(selected)}
            </CardTitle>
            <CardDescription>
              <Link
                href={detailHref}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open resident profile
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {sectionHeader("care_plans", "Care plans", chart.carePlans.length)}
              {openSections.care_plans ? (
                <ul className="space-y-1 text-xs">
                  {chart.carePlans.length === 0 ? (
                    <li className="text-slate-500">No care plans.</li>
                  ) : (
                    chart.carePlans.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-1 dark:border-slate-800">
                        <span>
                          v{c.version} · {c.status} · effective {c.effective_date} · review due {c.review_due_date}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              {sectionHeader("assessments", "Assessments", chart.assessments.length)}
              {openSections.assessments ? (
                <ul className="space-y-1 text-xs">
                  {chart.assessments.length === 0 ? (
                    <li className="text-slate-500">No assessments.</li>
                  ) : (
                    chart.assessments.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800"
                      >
                        <span>
                          {a.assessment_type} · {a.assessment_date}
                          {a.total_score != null ? ` · score ${a.total_score}` : ""}
                          {a.risk_level ? ` · ${a.risk_level}` : ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busy}
                          onClick={() => void logAssessmentRow(a)}
                        >
                          Log row access
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              {sectionHeader("medications", "Medications (orders)", chart.medications.length)}
              {openSections.medications ? (
                <ul className="space-y-1 text-xs">
                  {chart.medications.length === 0 ? (
                    <li className="text-slate-500">No medication orders.</li>
                  ) : (
                    chart.medications.map((m) => (
                      <li key={m.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
                        {m.medication_name} · {m.status}
                        {m.discontinued_date ? ` · discontinued ${m.discontinued_date}` : ""}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              {sectionHeader("emar", "eMAR (90 days)", chart.emarRecords.length)}
              {openSections.emar ? (
                <ul className="space-y-1 text-xs">
                  {chart.emarRecords.length === 0 ? (
                    <li className="text-slate-500">No eMAR rows in window.</li>
                  ) : (
                    chart.emarRecords.map((e) => (
                      <li key={e.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
                        {e.scheduled_time} · {e.status}
                        {e.is_prn ? " · PRN" : ""}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              {sectionHeader("daily_logs", "Daily logs (90 days)", chart.dailyLogs.length)}
              {openSections.daily_logs ? (
                <ul className="space-y-1 text-xs">
                  {chart.dailyLogs.length === 0 ? (
                    <li className="text-slate-500">No daily logs in window.</li>
                  ) : (
                    chart.dailyLogs.map((d) => (
                      <li key={d.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
                        {d.log_date} · {d.shift}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              {sectionHeader("incidents", "Incidents", chart.incidents.length)}
              {openSections.incidents ? (
                <ul className="space-y-1 text-xs">
                  {chart.incidents.length === 0 ? (
                    <li className="text-slate-500">No incidents.</li>
                  ) : (
                    chart.incidents.map((i) => (
                      <li key={i.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
                        #{i.incident_number} · {i.occurred_at} · {i.category} · {i.severity} · {i.status}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
