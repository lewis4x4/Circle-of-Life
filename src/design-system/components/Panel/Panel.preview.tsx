import { Panel } from "./Panel";

export function PanelPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PreviewSection state="default" title="Default">
        <Panel title="Occupancy">
          <div className="text-sm text-text-secondary">Census at 92% across portfolio.</div>
        </Panel>
      </PreviewSection>
      <PreviewSection state="withInfo" title="With info tooltip">
        <Panel title="Occupancy" subtitle="Portfolio rollup" info="Census ÷ licensed beds">
          <div className="text-sm text-text-secondary">Census at 92% across portfolio.</div>
        </Panel>
      </PreviewSection>
      <PreviewSection state="withActionCta" title="With action CTA">
        <Panel
          title="Priority alerts"
          subtitle="Unacknowledged by facility"
          info="High + medium, last 24h"
          actionCta={{ label: "Open queue", href: "/admin/executive/alerts" }}
        >
          <div className="text-sm text-text-secondary">3 high, 5 medium.</div>
        </Panel>
      </PreviewSection>
      <PreviewSection state="loading" title="Loading">
        <Panel title="Loading data" loading />
      </PreviewSection>
      <PreviewSection state="error" title="Error">
        <Panel title="Quality metrics" error="Could not load — retry momentarily" />
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
      className="rounded-md border border-border bg-surface-subtle"
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
