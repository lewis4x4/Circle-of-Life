import { PageShell } from "./PageShell";

const FIXED_UPDATED_AT = "2026-04-24T15:57:00-04:00";
const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

const baseAudit = {
  auditHref: "/admin/audit-log",
  updatedAt: FIXED_UPDATED_AT,
  now: FIXED_NOW,
};

export function PageShellPreview() {
  return (
    <div className="flex flex-col gap-8">
      <PreviewSection state="default" title="Default — title, subtitle, filters, main">
        <PageShell
          title="Triage Inbox"
          subtitle="All facilities · last 24 hours"
          filters={<div className="text-sm text-text-secondary">[filter bar placeholder]</div>}
          actions={
            <button
              type="button"
              className="rounded-sm border border-border bg-surface-elevated px-3 py-1 text-xs font-medium text-text-primary hover:border-border-strong"
            >
              Reset view
            </button>
          }
          audit={baseAudit}
        >
          <SamplePanel heading="Queue" note="6 new alerts" />
        </PageShell>
      </PreviewSection>

      <PreviewSection state="withRightRail" title="With right rail">
        <PageShell
          title="Executive summary"
          subtitle="Owner view · YTD"
          filters={<div className="text-sm text-text-secondary">[filter bar placeholder]</div>}
          rightRail={
            <>
              <SamplePanel heading="Priority alerts" note="3 items" />
              <SamplePanel heading="Action queue" note="12 items" />
            </>
          }
          audit={baseAudit}
        >
          <SamplePanel heading="KPI strip" note="6 tiles" />
        </PageShell>
      </PreviewSection>

      <PreviewSection state="noFilters" title="No filters">
        <PageShell title="Facility detail" subtitle="Oakridge ALF" audit={baseAudit}>
          <SamplePanel heading="Entity header" note="tabs + timeline" />
        </PageShell>
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
      className="rounded-md border border-border-strong bg-surface-subtle p-4"
    >
      <header className="flex items-center gap-2 pb-3">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="rounded-md border border-border bg-surface">{children}</div>
    </section>
  );
}

function SamplePanel({ heading, note }: { heading: string; note: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-4">
      <div className="text-sm font-semibold text-text-primary">{heading}</div>
      <div className="text-xs text-text-muted">{note}</div>
    </div>
  );
}
