import { Sparkline } from "./Sparkline";

const DEFAULT_SERIES = [48, 50, 52, 51, 53, 55, 54, 57];
const FLAT_SERIES = [50, 50, 50, 50, 50, 50, 50];
const VOLATILE_SERIES = [20, 80, 30, 70, 25, 90, 15, 85];

export function SparklinePreview() {
  return (
    <div className="flex flex-col gap-6">
      <PreviewSection state="default" title="Default tone">
        <Sparkline data={DEFAULT_SERIES} ariaLabel="Default trend" />
      </PreviewSection>
      <PreviewSection state="flat" title="Flat series">
        <Sparkline data={FLAT_SERIES} tone="info" ariaLabel="Flat trend" />
      </PreviewSection>
      <PreviewSection state="volatile" title="Volatile series · danger tone">
        <Sparkline data={VOLATILE_SERIES} tone="danger" ariaLabel="Volatile trend" />
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
