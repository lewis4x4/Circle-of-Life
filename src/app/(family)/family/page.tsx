"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, CalendarClock, ClipboardList, FileText, HeartPulse, Loader2, Shield } from "lucide-react";

import {
  fetchFamilyHomeSnapshot,
  type FamilyFeedItem,
  type FamilyHomeSnapshot,
} from "@/lib/family/family-feed";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function FamilyHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FamilyHomeSnapshot | null>(null);

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
      const result = await fetchFamilyHomeSnapshot(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setSnapshot(null);
      } else {
        setLoadError(null);
        setSnapshot(result.data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load feed.");
      setSnapshot(null);
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
        Loading your feed…
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

  if (!snapshot) {
    return null;
  }

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Today Feed</CardTitle>
          <CardDescription>
            {snapshot.linkedResidents > 0 ? (
              <>
                Updates for <span className="font-medium text-stone-800">{snapshot.residentSummary}</span> from your care
                team.
              </>
            ) : (
              "When your account is linked to a resident, clinical and billing updates you are allowed to see appear here."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <StatPill label="Linked loved ones" value={snapshot.stats.linkedResidents} />
          <StatPill label="Clinical (7 days)" value={snapshot.stats.clinicalWeek} />
          <StatPill label="Open billing" value={snapshot.stats.billingOpen} />
          <StatPill label="Feed today" value={snapshot.stats.feedToday} />
        </CardContent>
      </Card>

      {snapshot.linkedResidents === 0 ? (
        <Card className="border-stone-200 bg-white text-stone-900">
          <CardContent className="py-8 text-center text-sm text-stone-600">
            No resident links on file yet. Ask your facility to send a family portal invitation.
          </CardContent>
        </Card>
      ) : snapshot.items.length === 0 ? (
        <Card className="border-stone-200 bg-white text-stone-900">
          <CardContent className="py-8 text-center text-sm text-stone-600">
            No recent incidents or invoices in your visible feed. Check back as your team posts updates.
          </CardContent>
        </Card>
      ) : (
        snapshot.items.map((item) => <FeedItemCard key={`${item.kind}-${item.id}`} item={item} />)
      )}

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">More in the portal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            href="/family/care-plan"
            className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-medium text-stone-800 hover:bg-stone-100"
          >
            <HeartPulse className="h-4 w-4 text-rose-500" />
            Care summary
          </Link>
          <Link
            href="/family/billing"
            className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-medium text-stone-800 hover:bg-stone-100"
          >
            <Banknote className="h-4 w-4 text-amber-600" />
            Billing summary
          </Link>
          <Link
            href="/family/calendar"
            className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-medium text-stone-800 hover:bg-stone-100"
          >
            <CalendarClock className="h-4 w-4 text-blue-600" />
            Calendar
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function FeedItemCard({ item }: { item: FamilyFeedItem }) {
  const icon =
    item.kind === "invoice" ? (
      <FileText className="h-4 w-4 text-orange-600" />
    ) : item.badge === "Clinical" ? (
      <ClipboardList className="h-4 w-4 text-rose-500" />
    ) : (
      <Shield className="h-4 w-4 text-stone-500" />
    );

  const inner = (
    <CardContent className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          {icon}
          {item.title}
        </div>
        <Badge className="border-stone-300 bg-stone-100 text-stone-700">{item.badge}</Badge>
      </div>
      <p className="mb-1 text-xs text-stone-500">
        {item.timeLabel} · {item.residentName}
      </p>
      <p className="text-sm text-stone-700">{item.detail}</p>
    </CardContent>
  );

  if (item.kind === "invoice") {
    return (
      <Link href={item.href} className="block">
        <Card className="border-stone-200 bg-white text-stone-900 transition-colors hover:border-orange-200">{inner}</Card>
      </Link>
    );
  }

  return <Card className="border-stone-200 bg-white text-stone-900">{inner}</Card>;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-900">{value}</p>
    </div>
  );
}
