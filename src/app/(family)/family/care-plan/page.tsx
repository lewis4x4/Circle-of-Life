"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileText, Loader2, ShieldCheck } from "lucide-react";

import {
  fetchFamilyCarePlanOverview,
  type FamilyCarePlanOverview,
  type FamilyResidentCarePlanView,
} from "@/lib/family/family-care-plan-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";
import { cn } from "@/lib/utils";

export default function FamilyCarePlanPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FamilyCarePlanOverview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    try {
      const result = await fetchFamilyCarePlanOverview(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setData(null);
      } else {
        setData(result.data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load care summary.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="mx-auto mt-20 max-w-lg rounded-lg border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-48 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium tracking-wide">Gathering care framework…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto mt-20 max-w-md space-y-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-foreground">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className={cn(
            "h-12 w-full rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
          onClick={() => void load()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-8 pt-12 md:pt-20">
      <FamilySectionIntro
        active="care"
        title="Care Summary"
        description="A plain-language view of the current care approach, what the team is watching, and how support is structured day to day."
        residentSummary={
          data.residents.length === 1
            ? data.residents[0]?.residentName
            : data.residents.length > 1
              ? `${data.residents[0]?.residentName ?? "Your loved one"} and others`
              : undefined
        }
      />

      <div className="w-full space-y-12">
        {data.residents.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border p-10 text-center">
            <p className="mb-2 font-serif text-xl italic text-foreground">No care plan visible yet.</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Once the clinical team finalizes and publishes the care framework, it will appear here.
            </p>
          </div>
        ) : (
          data.residents.map((r) => <ResidentCareBlocks key={r.residentId} view={r} />)
        )}

        {/* Visibility scope footer */}
        <div className="mt-12 rounded-lg border border-border bg-muted p-6 md:p-8">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              How to use this page
            </p>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Read-only
            </span>
          </div>
          <p className="mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
            This is a shared care summary, not the team&apos;s full internal clinical chart. If anything feels
            unclear, ask a question and they can give you more context.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={cn(
                "inline-flex h-12 min-w-[140px] flex-1 items-center justify-center rounded-lg border border-border bg-card font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
              onClick={() => window.print()}
            >
              <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
              Print
            </button>
            <Link
              href="/family/messages"
              className={cn(
                "inline-flex h-12 min-w-[140px] flex-1 items-center justify-center rounded-lg bg-primary font-medium text-primary-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Ask A Question
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResidentCareBlocks({ view }: { view: FamilyResidentCarePlanView }) {
  return (
    <div className="w-full space-y-6 print:break-inside-avoid">
      {/* Resident plan summary node — warm split-theme bg-muted */}
      <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
        <div className="mb-6 border-b border-border pb-6 text-center">
          <h2 className="mb-1 font-serif text-2xl text-foreground">{view.residentName}</h2>
          <p className="text-sm text-muted-foreground">
            Plan v{view.version} ({view.statusLabel})
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <InfoPill label="Last updated" value={view.lastUpdatedLabel} colored />
          <InfoPill label="Effective" value={view.effectiveDateLabel} />
          <InfoPill label="Next review due" value={view.reviewDueDateLabel} />
        </div>

        {view.planNotes ? (
          <div className="mt-8 border-t border-border pt-6">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Clinical Notes</p>
            <p className="text-[15px] leading-relaxed text-foreground">{view.planNotes}</p>
          </div>
        ) : null}
      </div>

      {/* Plan line items */}
      {view.sections.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted p-8 text-center">
          <p className="text-muted-foreground">No protocol lines are published on this plan yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {view.sections.map((sec) => (
            <SectionCard key={sec.category} title={sec.categoryLabel} items={sec.items} />
          ))}
        </div>
      )}
    </div>
  );
}

function InfoPill({ label, value, colored = false }: { label: string; value: string; colored?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border px-4 py-3 text-center",
        colored ? "border-primary/30 bg-primary/10" : "border-border bg-card",
      )}
    >
      <p
        className={cn(
          "mb-1 text-[10px] font-bold uppercase tracking-wider",
          colored ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  items,
}: {
  title: string;
  items: { id: string; title: string; bodyLines: string[] }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-muted p-6 md:p-8">
      <h3 className="mb-6 font-serif text-lg text-foreground">{title}</h3>
      <div className="space-y-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative pb-2 pl-6 before:absolute before:bottom-0 before:left-0 before:top-2 before:w-1 before:rounded-full before:bg-primary/30 last:pb-0"
          >
            <p className="mb-3 text-base font-semibold text-foreground">{item.title}</p>
            <div className="space-y-2.5">
              {item.bodyLines.map((line, i) => (
                <p
                  key={`${item.id}-${i}`}
                  className="flex items-start gap-3 text-[15px] font-medium leading-relaxed text-foreground"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
                  <span>{line}</span>
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
