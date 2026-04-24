import { TopBar } from "./TopBar";

export function TopBarPreview() {
  return (
    <div className="flex flex-col gap-6">
      <PreviewSection state="default" title="Default — title + subtitle + scope">
        <TopBar
          title="Triage Inbox"
          subtitle="All facilities · last 24 hours"
          scope={<ScopePlaceholder />}
          actions={
            <button
              type="button"
              className="rounded-sm border border-border bg-surface-elevated px-3 py-1 text-xs font-medium text-text-primary hover:border-border-strong"
            >
              Reset view
            </button>
          }
          notifications={{ count: 0 }}
        />
      </PreviewSection>

      <PreviewSection state="withCopilot" title="With Copilot button">
        <TopBar
          title="Executive summary"
          subtitle="Owner view · YTD"
          scope={<ScopePlaceholder />}
          copilot={{ visible: true }}
          notifications={{ count: 0 }}
        />
      </PreviewSection>

      <PreviewSection state="withNotifications" title="With unread notifications">
        <TopBar
          title="Quality metrics"
          subtitle="All facilities"
          scope={<ScopePlaceholder />}
          notifications={{ count: 12 }}
        />
      </PreviewSection>
    </div>
  );
}

function ScopePlaceholder() {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-elevated px-2 py-1 text-xs font-medium text-text-secondary">
      Owner · Group · Facility
    </span>
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
      <div>{children}</div>
    </section>
  );
}
