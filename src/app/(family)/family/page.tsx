"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Banknote, FileText, Loader2, Shield, Heart, ChevronRight, Megaphone } from "lucide-react";

import {
  fetchFamilyHomeSnapshot,
  type FamilyFeedItem,
  type FamilyFeedNoteItem,
  type FamilyHomeSnapshot,
} from "@/lib/family/family-feed";
import { FamilyPortalNoteEntry } from "@/components/family-portal/FamilyPortalNoteEntry";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
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
      <div className="mx-auto max-w-lg rounded-lg border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-48 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium tracking-wide">Opening journal…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto mt-12 max-w-md space-y-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-foreground">
          <Shield className="mx-auto mb-3 h-8 w-8 text-destructive" />
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

  if (!snapshot) {
    return null;
  }

  const initial = snapshot.residentSummary ? snapshot.residentSummary.charAt(0).toUpperCase() : "H";
  const firstName = snapshot.residentSummary ? snapshot.residentSummary.split(" ")[0] : "Resident";

  return (
    <div className="flex flex-col items-center pb-8">
      {/* Full bleed cover photo — kept as a warm cue per the family-shell warmth allowance */}
      <div className="absolute inset-x-0 top-0 z-0 h-48 w-full overflow-hidden md:h-64">
        <div className="relative h-full w-full">
          <Image
            src="/family-cover.png"
            alt="Warm watercolor dawn light"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-90 mix-blend-multiply"
          />
        </div>
      </div>

      <div className="relative z-10 mt-20 w-full max-w-2xl px-4 md:mt-32">
        {/* Overlapping avatar — warm split-theme keeps avatar visible above the cover image */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-border bg-card p-2 md:h-32 md:w-32">
            <div className="flex h-full w-full items-center justify-center rounded-full border border-border">
              <span className="font-serif text-4xl font-semibold text-foreground md:text-2xl">{initial}</span>
            </div>
          </div>

          {snapshot.linkedResidents > 0 ? (
            <>
              <h1 className="mb-2 font-serif text-4xl tracking-tight text-foreground md:text-2xl">
                <span className="font-medium text-foreground">{snapshot.residentSummary}</span>
              </h1>
              <p className="mx-auto mb-8 max-w-lg font-serif text-base italic text-muted-foreground md:text-lg">
                Care Journal
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 font-serif text-4xl tracking-tight text-foreground md:text-2xl">Welcome</h1>
              <p className="mx-auto max-w-lg text-sm text-muted-foreground md:text-base">
                Ask your facility for an invitation link to connect your loved one.
              </p>
            </>
          )}

          {/* Quick glance stats */}
          {snapshot.linkedResidents > 0 && (
            <div className="mx-auto flex w-full max-w-lg flex-wrap justify-center gap-2">
              <StatChip label="Connected" value={snapshot.stats.linkedResidents} />
              {Number(snapshot.stats.staffNotes) > 0 && (
                <StatChip label="Team updates" value={snapshot.stats.staffNotes} />
              )}
              <StatChip label="Recent Clinical" value={snapshot.stats.clinicalWeek} />
              {Number(snapshot.stats.billingOpen) > 0 && (
                <StatChip label="Open Invoices" value={snapshot.stats.billingOpen} />
              )}
            </div>
          )}
        </div>

        {snapshot.featuredNote ? (
          <FeaturedStaffNote note={snapshot.featuredNote} />
        ) : null}

        {/* Journal feed */}
        <div className="mt-10 w-full md:mt-16">
          <div className="mb-10 flex items-center justify-center">
            <div className="h-px flex-1 bg-border"></div>
            <h2 className="px-6 text-center font-serif text-2xl tracking-tight text-foreground md:text-3xl">
              {firstName}&apos;s Updates
            </h2>
            <div className="h-px flex-1 bg-border"></div>
          </div>

          {snapshot.linkedResidents === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="font-serif text-xl italic text-muted-foreground">The journal is quiet right now.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask your facility for an invitation link to connect your loved one.
              </p>
            </div>
          ) : snapshot.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="font-serif text-xl italic text-muted-foreground">No recent activity yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Care team updates and billing notices will appear here when posted.
              </p>
              <Link
                href="/family/messages"
                className={cn(
                  "mt-6 inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                )}
              >
                View care team updates
              </Link>
            </div>
          ) : (
            <div className="space-y-6 md:space-y-8">
              {snapshot.items
                .filter((item) => item.kind !== "note" || item.id !== snapshot.featuredNote?.id)
                .map((item) => (
                  <JournalEntryCard key={`${item.kind}-${item.id}`} item={item} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeaturedStaffNote({ note }: { note: FamilyFeedNoteItem }) {
  return (
    <section
      aria-label="Latest care team update"
      className="mb-10 w-full rounded-lg border border-primary/20 bg-card/95 p-5 shadow-sm backdrop-blur-sm md:p-6"
    >
      <div className="mb-4 flex items-center gap-2 text-primary">
        <Megaphone className="h-4 w-4 shrink-0" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-[0.18em]">Latest from your care team</p>
      </div>
      <FamilyPortalNoteEntry
        id={note.id}
        body={note.body}
        timestamp={note.sortAt}
        authorLabel="Care team"
        variant="staff"
      />
      <div className="mt-4 flex justify-end">
        <Link
          href={note.href}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:text-primary/80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
        >
          View all updates
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function JournalEntryCard({ item }: { item: FamilyFeedItem }) {
  const isInvoice = item.kind === "invoice";
  const isNote = item.kind === "note";
  const isClinical = item.badge === "Clinical";

  const iconWrapClass = isInvoice
    ? "bg-warning/10 border-warning/30"
    : isNote
      ? "bg-primary/10 border-primary/30"
      : isClinical
        ? "bg-success/10 border-success/30"
        : "bg-info/10 border-info/30";

  const iconColorClass = isInvoice
    ? "text-warning"
    : isNote
      ? "text-primary"
      : isClinical
        ? "text-success"
        : "text-info";

  const icon = isInvoice ? (
    <Banknote className={cn("h-5 w-5", iconColorClass)} />
  ) : isNote ? (
    <Megaphone className={cn("h-5 w-5", iconColorClass)} />
  ) : isClinical ? (
    <Heart className={cn("h-5 w-5", iconColorClass)} />
  ) : (
    <FileText className={cn("h-5 w-5", iconColorClass)} />
  );

  const inner = (
    <div className="group relative rounded-lg border border-border bg-card p-6 transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:bg-muted/40">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.timeLabel}
          </span>
          <h3 className="font-serif text-xl leading-tight text-foreground">{item.title}</h3>
        </div>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border",
            iconWrapClass,
          )}
        >
          {icon}
        </div>
      </div>

      <p className="text-base font-semibold leading-relaxed text-foreground">{item.detail}</p>

      {isInvoice && (
        <div className="group/btn relative z-10 mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover/btn:text-foreground">
            Review Documentation
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover/btn:bg-muted/80">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative w-full">
      {isInvoice || isNote ? (
        <Link
          href={item.href}
          className="block rounded-lg outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        >
          {inner}
        </Link>
      ) : (
        <div>{inner}</div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg px-4 py-1.5">
      <span className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-serif text-lg tabular-nums text-foreground">{value}</span>
    </div>
  );
}
