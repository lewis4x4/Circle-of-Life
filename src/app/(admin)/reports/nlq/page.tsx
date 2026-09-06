"use client";

import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HavenInsightHistoryEntry } from "@/lib/reports/haven-insight-history";
import {
  HAVEN_INSIGHT_HISTORY_LIMIT,
  mergeHavenInsightHistory,
  parseHavenInsightHistory,
} from "@/lib/reports/haven-insight-history";
import type { HavenInsightMatchOutcome } from "@/lib/reports/haven-insight-match";
import { matchHavenInsightTemplates } from "@/lib/reports/haven-insight-match";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Json } from "@/types/database";

const EXAMPLE_SHORTCUTS = [
  {
    text: "Show me falls by facility this quarter",
    label: `→ Show me falls by facility this quarter`,
    tag: "Clinical / risk",
  },
  {
    text: "Compare occupancy across all facilities",
    label: `→ Compare occupancy across all facilities`,
    tag: "Operations",
  },
  {
    text: "Which residents need care plan review?",
    label: `→ Which residents need care plan review?`,
    tag: "Clinical / operations",
  },
  {
    text: "What's our labor cost trend?",
    label: `→ What's our labor cost trend?`,
    tag: "Workforce / finance",
  },
] as const;

function coverageLine(description: string, defaultRange: string): string {
  const trimmed = description.trim().replace(/\s+/g, " ");
  const first = trimmed.split(". ")[0] ?? trimmed;
  return `This template covers ${first.endsWith(".") ? first.slice(0, -1).toLowerCase() : first.toLowerCase()}. Default range: ${defaultRange}.`;
}

export default function ReportsNlqPage() {
  const supabase = createClient();

  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<HavenInsightMatchOutcome | null>(null);
  const [thumb, setThumb] = useState<"up" | "down" | null>(null);
  const [currentSettings, setCurrentSettings] = useState<Json | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const history = useMemo(() => parseHavenInsightHistory(currentSettings), [currentSettings]);

  const hydrate = useCallback(async () => {
    setLoadError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setUserId(ctx.ctx.userId);
      const { data, error } = await supabase
        .from("user_profiles")
        .select("settings")
        .eq("id", ctx.ctx.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      setCurrentSettings(data?.settings ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load preferences.");
    }
  }, [supabase]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const persistHistory = useCallback(
    async (entry: HavenInsightHistoryEntry) => {
      if (!userId) return;
      setPersistError(null);
      try {
        const fresh = await supabase.from("user_profiles").select("settings").eq("id", userId).maybeSingle();

        const err = fresh.error;
        if (err) throw new Error(err.message);

        const nextSettings = mergeHavenInsightHistory(fresh.data?.settings ?? null, entry);
        const { error: upErr } = await supabase
          .from("user_profiles")
          .update({ settings: nextSettings })
          .eq("id", userId);
        if (upErr) throw new Error(upErr.message);
        setCurrentSettings(nextSettings);
      } catch (e) {
        setPersistError(e instanceof Error ? e.message : "Could not save question history.");
      }
    },
    [supabase, userId],
  );

  const applyQuestion = useCallback(
    async (nextQuery: string) => {
      const q = nextQuery.trim();
      setQuery(q);
      if (!q) {
        setOutcome(null);
        setThumb(null);
        return;
      }
      const next = matchHavenInsightTemplates(q);
      setOutcome(next);
      setThumb(null);

      const entry: HavenInsightHistoryEntry = {
        question: q,
        asked_at: new Date().toISOString(),
        outcome: next.variant === "match" ? "matched" : "no_match",
        template_slug: next.variant === "match" ? next.best.slug : null,
        template_name: next.variant === "match" ? next.best.name : null,
      };
      await persistHistory(entry);
    },
    [persistHistory],
  );

  const applyExample = useCallback((text: string) => {
    setQuery(text);
    setOutcome(null);
    setThumb(null);
  }, []);

  function clearToAskAgain() {
    setOutcome(null);
    setThumb(null);
    void document.getElementById("haven-insight-query")?.focus();
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <div className="relative z-10 w-full space-y-6">
        <div className="mt-4">
          <ReportsHubNav />
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Find a report</h1>
          <p className="text-sm text-muted-foreground">
            Natural language maps to approved templates and governed report definitions.
          </p>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        ) : null}
        {persistError ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            {persistError}
          </div>
        ) : null}

        <Card className="border-border">
          <CardHeader className="space-y-2">
            <CardTitle className="text-lg">Ask a reporting question</CardTitle>
            <CardDescription className="flex items-start gap-2 text-[13px] leading-relaxed font-normal [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
              <ShieldCheck aria-hidden className="text-muted-foreground" />
              <span className="text-foreground/90">
                AI assistance suggests templates only — RBAC and official metrics remain enforced.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              id="haven-insight-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              rows={5}
              className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Example: Show me falls by facility over the last 90 days."
              aria-label="Reporting question"
            />

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Try one of these</p>
              <ul className="space-y-1">
                {EXAMPLE_SHORTCUTS.map((ex) => (
                  <li key={ex.text}>
                    <button
                      type="button"
                      className={cn(
                        "w-full text-left font-sans text-sm text-muted-foreground transition-colors",
                        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1 py-1 -mx-1",
                      )}
                      onClick={() => applyExample(ex.text)}
                    >
                      <span>{ex.label}</span>
                      <span className="sr-only">{` (${ex.tag})`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void applyQuestion(query)} className="rounded-md">
                Find matching reports
              </Button>
            </div>

            <details className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground select-none marker:content-none [&::-webkit-details-marker]:hidden [&::marker]:content-none">
                Which reports can I find?
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </summary>
              <ul className="mt-3 space-y-2 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Operations</span>: Occupancy, census, admissions, discharges.
                </li>
                <li>
                  <span className="font-medium text-foreground">Workforce</span>: Staffing, overtime, certifications, schedules.
                </li>
                <li>
                  <span className="font-medium text-foreground">Clinical</span>: Incidents, falls, medication errors, care plans.
                </li>
                <li>
                  <span className="font-medium text-foreground">Finance</span>: AR aging, revenue, payer mix, billing.
                </li>
                <li>
                  <span className="font-medium text-foreground">Compliance</span>: Surveys, citations, expirations.
                </li>
              </ul>
            </details>
          </CardContent>
        </Card>

        {history.length > 0 ? (
          <section aria-labelledby="haven-insight-recent-heading" className="space-y-3">
            <h2 id="haven-insight-recent-heading" className="text-sm font-semibold text-foreground">
              Recent questions
            </h2>
            <p className="text-xs text-muted-foreground">
              Last {Math.min(history.length, HAVEN_INSIGHT_HISTORY_LIMIT)} saved to your profile (newest first).
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {history.map((row) => {
                const tpl =
                  row.outcome === "matched" ? row.template_name ?? row.template_slug ?? "Matched" : "No match";
                return (
                  <li key={`${row.asked_at}-${row.question}`}>
                    <button
                      type="button"
                      onClick={() => void applyQuestion(row.question)}
                      className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-sm text-foreground">{row.question}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.asked_at), { addSuffix: true })} · {tpl}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {outcome ? (
          <ResponsePanel
            outcome={outcome}
            thumb={thumb}
            onThumb={(v) => setThumb(v)}
            onDifferentQuestion={clearToAskAgain}
          />
        ) : null}
      </div>
    </div>
  );
}

type ResponsePanelProps = {
  outcome: HavenInsightMatchOutcome;
  thumb: "up" | "down" | null;
  onThumb: (value: "up" | "down") => void;
  onDifferentQuestion: () => void;
};

function ResponsePanel({ outcome, thumb, onThumb, onDifferentQuestion }: ResponsePanelProps) {
  const feedbackPromptId = `haven-insight-feedback-${outcome.variant}`;

  if (outcome.variant === "match") {
    const t = outcome.best.seed;
    const coverage = coverageLine(t.description, t.defaultRange);

    const topRunners = outcome.runnersUp.slice(0, 3);

    return (
      <section
        className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
        aria-live="polite"
        aria-labelledby="haven-insight-match-title"
      >
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="haven-insight-match-title" className="text-base font-semibold tracking-tight text-foreground">
              Best match: {outcome.best.name}{" "}
              <span className="tabular-nums text-muted-foreground">{outcome.best.confidence}%</span>
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{coverage}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/admin/reports/run/template/${encodeURIComponent(outcome.best.slug)}`}
              className={cn(buttonVariants({ size: "sm" }), "rounded-md")}
            >
              Run with this question&apos;s range
            </Link>
            <Link
              href={`/admin/reports/templates/${encodeURIComponent(outcome.best.slug)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-md")}
            >
              Preview first
            </Link>
          </div>
          {topRunners.length ? (
            <div className="mt-6">
              <p className="text-sm font-medium text-foreground">Other possible matches</p>
              <ul className="mt-2 list-none space-y-1 text-sm text-muted-foreground">
                {topRunners.map((alt) => (
                  <li key={alt.slug}>
                    ·{" "}
                    <span className="text-foreground">
                      {alt.name}{" "}
                      <span className="tabular-nums text-muted-foreground">({alt.confidence}% match)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FeedbackRow id={feedbackPromptId} thumb={thumb} onThumb={onThumb} />
        </div>
      </section>
    );
  }

  const closestRows = outcome.closest;

  return (
    <section
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      aria-live="polite"
      aria-labelledby="haven-insight-nomatch-title"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="haven-insight-nomatch-title" className="text-base font-semibold tracking-tight text-foreground">
          No template fits this question.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Haven Insight matched against {outcome.templateCount} templates and found no strong fit (highest
          confidence{" "}
          <span className="tabular-nums">{outcome.highestConfidence}%</span>
          ).
        </p>

        <div className="mt-6">
          <p className="text-sm font-medium text-foreground">Closest options (low confidence)</p>
          {closestRows.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No neighboring template scored above baseline.</p>
          ) : (
            <ul className="mt-2 list-none space-y-1 text-sm text-muted-foreground">
              {closestRows.map((alt) => (
                <li key={alt.slug}>
                  ·{" "}
                  <span className="text-foreground">
                    {alt.name}{" "}
                    <span className="tabular-nums text-muted-foreground">({alt.confidence}%)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/admin/reports/templates"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-md")}
          >
            Request a new template
          </Link>
          <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={onDifferentQuestion}>
            Try a different question
          </Button>
        </div>

        <FeedbackRow id={feedbackPromptId} thumb={thumb} onThumb={onThumb} />
      </div>
    </section>
  );
}

function FeedbackRow({
  id,
  thumb,
  onThumb,
}: {
  id: string;
  thumb: "up" | "down" | null;
  onThumb: (value: "up" | "down") => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4" id={id}>
      <span className="text-sm text-muted-foreground">Was this helpful?</span>
      <div className="flex gap-1">
        <Button
          type="button"
          variant={thumb === "up" ? "default" : "outline"}
          size="icon-xs"
          className="rounded-md size-8"
          aria-pressed={thumb === "up"}
          aria-label="Thumbs up — this was helpful"
          onClick={() => onThumb("up")}
        >
          <ThumbsUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant={thumb === "down" ? "default" : "outline"}
          size="icon-xs"
          className="rounded-md size-8"
          aria-pressed={thumb === "down"}
          aria-label="Thumbs down — not helpful"
          onClick={() => onThumb("down")}
        >
          <ThumbsDown className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
