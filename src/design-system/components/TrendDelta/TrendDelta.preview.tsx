import { TrendDelta } from "./TrendDelta";

export function TrendDeltaPreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="up" title="Up · no goodDirection (muted)">
        <TrendDelta direction="up" value={1.2} unit="pp" period="vs prior 7 days" />
      </PreviewSection>
      <PreviewSection state="down" title="Down · no goodDirection (muted)">
        <TrendDelta direction="down" value={3} unit="%" period="WoW" />
      </PreviewSection>
      <PreviewSection state="flat" title="Flat">
        <TrendDelta direction="flat" value={0} unit="pts" period="vs prior 7 days" />
      </PreviewSection>
      <PreviewSection state="goodUp" title="Up matches goodDirection=up (success)">
        <TrendDelta
          direction="up"
          value={2.4}
          unit="pp"
          period="vs prior 7 days"
          goodDirection="up"
        />
      </PreviewSection>
      <PreviewSection state="goodDown" title="Down matches goodDirection=down (success)">
        <TrendDelta
          direction="down"
          value={5}
          unit="days"
          period="MoM"
          goodDirection="down"
        />
      </PreviewSection>
      <PreviewSection state="pp" title="Unit variants">
        <div className="flex flex-col gap-1">
          <TrendDelta direction="up" value={1.2} unit="pp" period="vs prior 7 days" goodDirection="up" />
          <TrendDelta direction="down" value={4} unit="pts" period="QoQ" goodDirection="up" />
          <TrendDelta direction="up" value={3.5} unit="%" period="MoM" goodDirection="down" />
          <TrendDelta direction="flat" value={0} unit="days" period="YoY" />
        </div>
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
