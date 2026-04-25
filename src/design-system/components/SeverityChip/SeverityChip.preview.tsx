import { SeverityChip } from "./SeverityChip";

export function SeverityChipPreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="low" title="Low severity">
        <SeverityChip level="low" />
      </PreviewSection>
      <PreviewSection state="medium" title="Medium severity">
        <SeverityChip level="medium" />
      </PreviewSection>
      <PreviewSection state="high" title="High severity">
        <SeverityChip level="high" />
      </PreviewSection>
      <PreviewSection state="highFromMedium" title="Escalation: high from medium">
        <SeverityChip level="high" trend={{ from: "medium", ageText: "3d ago" }} />
      </PreviewSection>
      <PreviewSection state="withoutTrend" title="Without trend (medium)">
        <SeverityChip level="medium" />
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
      <div className="p-4">{children}</div>
    </section>
  );
}
