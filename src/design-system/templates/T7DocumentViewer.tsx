"use client";

import { type AuditFooterProps } from "../components/AuditFooter";
import { PageShell } from "../components/PageShell";

export type T7DocumentViewerProps = {
  title: string;
  subtitle?: string;
  /** The document body (PDF embed, image, rendered HTML — caller renders). */
  document: React.ReactNode;
  /** Document metadata key/value list (uploaded, signer, version, etc.). */
  metadata: Array<{ label: string; value: React.ReactNode }>;
  /** Activity rail entries (signed, viewed, annotated, etc.). */
  activity: Array<{ id: string; label: string; occurredAt: string; actor?: string }>;
  /** Annotation toolbar slot (highlight/comment/redact). */
  toolbar?: React.ReactNode;
  audit: AuditFooterProps;
};

export function T7DocumentViewer({
  title,
  subtitle,
  document,
  metadata,
  activity,
  toolbar,
  audit,
}: T7DocumentViewerProps) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      audit={audit}
      rightRail={
        <DocumentMetadata metadata={metadata} activity={activity} />
      }
    >
      {toolbar && (
        <section
          aria-label="Annotation toolbar"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
        >
          {toolbar}
        </section>
      )}

      <section
        aria-label="Document pane"
        className="rounded-md border border-border bg-surface p-4"
      >
        {document}
      </section>
    </PageShell>
  );
}

function DocumentMetadata({
  metadata,
  activity,
}: {
  metadata: T7DocumentViewerProps["metadata"];
  activity: T7DocumentViewerProps["activity"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Document metadata" className="rounded-md border border-border bg-surface">
        <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
          Document metadata
        </header>
        <dl className="flex flex-col">
          {metadata.map((field) => (
            <div key={field.label} className="flex justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0">
              <dt className="text-xs font-semibold uppercase tracking-caps text-text-muted">
                {field.label}
              </dt>
              <dd className="text-sm text-text-primary">{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Document activity" className="rounded-md border border-border bg-surface">
        <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
          Activity
        </header>
        <ol className="flex flex-col">
          {activity.map((entry) => (
            <li key={entry.id} className="border-b border-border px-4 py-2 last:border-b-0">
              <span className="block text-sm text-text-primary">{entry.label}</span>
              <span className="block text-xs text-text-muted">
                <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                {entry.actor && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>{entry.actor}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
