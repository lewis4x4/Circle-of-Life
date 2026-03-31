"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, FileText, Loader2, ShieldCheck } from "lucide-react";

import {
  fetchFamilyCarePlanOverview,
  type FamilyCarePlanOverview,
  type FamilyResidentCarePlanView,
} from "@/lib/family/family-care-plan-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading care summary…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 pb-16 md:pb-0">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }), "border-stone-300")}
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4 pb-16 md:pb-0 print:pb-0">
      {data.residents.length === 0 ? (
        <Card className="border-stone-200 bg-white text-stone-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-display">Care Summary</CardTitle>
            <CardDescription>
              No care plans are available for your linked residents yet, or you do not have access to clinical
              documents on your family link.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        data.residents.map((r) => <ResidentCareBlocks key={r.residentId} view={r} />)
      )}

      <Card className="border-stone-200 bg-white text-stone-900 print:hidden">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Family visibility scope
            </p>
            <Badge className="border-stone-300 bg-stone-100 text-stone-700">Read-only</Badge>
          </div>
          <p className="mb-3 text-sm text-stone-700">
            This view reflects care plan records the clinical team has shared for your linked residents. For questions,
            use secure messages.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
              onClick={() => window.print()}
            >
              <FileText className="mr-1.5 h-4 w-4" />
              Printable View
            </Button>
            <Link
              href="/family/messages"
              className={cn(
                buttonVariants({ variant: "default" }),
                "inline-flex h-10 items-center justify-center bg-orange-600 text-white hover:bg-orange-500",
              )}
            >
              <ClipboardCheck className="mr-1.5 h-4 w-4" />
              Request Clarification
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResidentCareBlocks({ view }: { view: FamilyResidentCarePlanView }) {
  return (
    <div className="care-summary-resident space-y-4 print:break-inside-avoid">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Care Summary</CardTitle>
          <CardDescription>
            {view.residentName} · Plan v{view.version} ({view.statusLabel})
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-2">
          <InfoPill label="Last updated" value={view.lastUpdatedLabel} />
          <InfoPill label="Effective" value={view.effectiveDateLabel} />
          <InfoPill label="Next review due" value={view.reviewDueDateLabel} />
          <InfoPill label="Clinical notes" value={view.planNotes ? "See below" : "—"} />
        </CardContent>
        {view.planNotes ? (
          <CardContent className="border-t border-stone-100 pt-0">
            <p className="text-sm text-stone-700">{view.planNotes}</p>
          </CardContent>
        ) : null}
      </Card>

      {view.sections.length === 0 ? (
        <Card className="border-stone-200 bg-white text-stone-900">
          <CardContent className="p-4 text-sm text-stone-600">
            No line items are published on this plan yet. Check back after the care team completes documentation.
          </CardContent>
        </Card>
      ) : (
        view.sections.map((sec) => (
          <SectionCard key={sec.category} title={sec.categoryLabel} items={sec.items} />
        ))
      )}
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
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
    <Card className="border-stone-200 bg-white text-stone-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="space-y-2 border-b border-stone-100 pb-3 last:border-0 last:pb-0">
            <p className="text-sm font-semibold text-stone-900">{item.title}</p>
            {item.bodyLines.map((line, i) => (
              <p key={`${item.id}-${i}`} className="inline-flex gap-2 text-sm text-stone-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
