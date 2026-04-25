import { AuditFooter } from "./AuditFooter";

const FIXED_UPDATED_AT = "2026-04-24T15:56:00-04:00";
const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function AuditFooterPreview() {
  return (
    <div className="flex flex-col gap-6">
      <PreviewSection title="Default — live" state="default">
        <AuditFooter
          auditHref="/admin/audit-log"
          updatedAt={FIXED_UPDATED_AT}
          now={FIXED_NOW}
        />
      </PreviewSection>

      <PreviewSection title="Offline — grayed dot" state="offline">
        <AuditFooter
          auditHref="/admin/audit-log"
          updatedAt={FIXED_UPDATED_AT}
          now={FIXED_NOW}
          live={false}
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
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}
