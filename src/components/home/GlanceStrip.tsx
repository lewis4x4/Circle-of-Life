import { cn } from "@/lib/utils";

export type GlanceStripProps = {
  counts: { regulatory: number; rent: number; assigned: number; fyi: number; clearedToday: number };
  rightNote: string;
  rentLive: boolean;
};

const DOT: Record<string, string> = {
  regulatory: "bg-emar-held",
  rent: "bg-warning",
  assigned: "bg-primary",
  fyi: "bg-muted-foreground/60",
  cleared: "bg-success",
};

/** Today at a glance: the same compact strip pattern the executive page uses, static here. */
export function GlanceStrip({ counts, rightNote, rentLive }: GlanceStripProps) {
  const items: Array<{ key: string; label: string; value: string }> = [
    { key: "regulatory", label: "Regulatory / safety", value: String(counts.regulatory) },
    { key: "rent", label: "Rent past due", value: rentLive ? String(counts.rent) : "Week 2" },
    { key: "assigned", label: "Assigned", value: String(counts.assigned) },
    { key: "fyi", label: "FYI", value: String(counts.fyi) },
    { key: "cleared", label: "Cleared today", value: String(counts.clearedToday) },
  ];
  return (
    <section aria-label="Today at a glance" className="mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
      <h2 className="mr-2 text-[13px] font-semibold text-foreground">Today at a glance</h2>
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("size-1.5 rounded-full", DOT[item.key])} aria-hidden />
          {item.label} <span className="font-medium text-foreground tabular-nums" data-testid={`glance-${item.key}`}>{item.value}</span>
        </span>
      ))}
      <span className="ml-auto font-medium text-foreground">{rightNote}</span>
    </section>
  );
}
