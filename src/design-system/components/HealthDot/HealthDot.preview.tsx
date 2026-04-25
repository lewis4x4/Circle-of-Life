import { HealthDot } from "./HealthDot";

export function HealthDotPreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="healthy" title="Healthy (≥80)">
        <HealthDot score={92} />
      </PreviewSection>
      <PreviewSection state="warning" title="Warning (65–79)">
        <HealthDot score={72} />
      </PreviewSection>
      <PreviewSection state="danger" title="Danger (<65)">
        <HealthDot score={48} />
      </PreviewSection>
      <PreviewSection state="custom max" title="Custom max (out of 10)">
        <HealthDot score={7} max={10} ariaLabel="Risk score 7 out of 10" />
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
