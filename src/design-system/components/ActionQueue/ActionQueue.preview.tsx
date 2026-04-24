import { ActionQueue } from "./ActionQueue";

export function ActionQueuePreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="empty" title="Empty">
        <ActionQueue items={[]} />
      </PreviewSection>
      <PreviewSection state="oneRow" title="One row">
        <ActionQueue
          items={[
            {
              id: "emar",
              label: "eMAR missed doses",
              sublabel: "Last 24h",
              count: 2,
              href: "/admin/medications/errors",
            },
          ]}
        />
      </PreviewSection>
      <PreviewSection state="manyRows" title="Many rows">
        <ActionQueue
          items={[
            { id: "care", label: "Care plan reviews", sublabel: "Due this week", count: 5, href: "/admin/care-plans/reviews-due" },
            { id: "certs", label: "Certifications expiring", sublabel: "30-day window", count: 3, href: "/admin/certifications" },
            { id: "incidents", label: "High-severity incidents", sublabel: "Unacked", count: 1, href: "/admin/incidents" },
            { id: "family", label: "Family messages", sublabel: "Needs reply", count: 8, href: "/admin/family-messages" },
          ]}
        />
      </PreviewSection>
      <PreviewSection state="zeroCount" title="Zero count (neutral badge)">
        <ActionQueue
          items={[
            { id: "calm", label: "All clear", count: 0, href: "/admin" },
          ]}
        />
      </PreviewSection>
    </div>
  );
}

function PreviewSection({
  title,
  state,
  children,
}: {
  title: string;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-state={state}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
