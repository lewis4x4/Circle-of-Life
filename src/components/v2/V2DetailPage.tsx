import Link from "next/link";
import { notFound } from "next/navigation";

import { T3EntityDetail } from "@/design-system/templates";
import { uiV2 } from "@/lib/flags";
import { loadV2Detail } from "@/lib/v2-detail";
import type { V2ListId } from "@/lib/v2-lists";

const LIST_HOMES: Record<V2ListId, { label: string; href: string }> = {
  residents: { label: "← All residents", href: "/admin/residents" },
  incidents: { label: "← All incidents", href: "/admin/incidents" },
  alerts: { label: "← All alerts", href: "/admin/executive/alerts" },
  admissions: { label: "← All admissions", href: "/admin/admissions" },
};

export async function V2DetailPage({
  listId,
  recordId,
}: {
  listId: V2ListId;
  recordId: string;
}) {
  if (!uiV2()) notFound();
  const load = await loadV2Detail(listId, recordId);
  if (!load) notFound();

  const home = LIST_HOMES[listId];

  return (
    <T3EntityDetail
      title={load.title}
      subtitle={load.subtitle ?? undefined}
      identifiers={load.identifiers.map((field) => ({
        label: field.label,
        value: field.value,
      }))}
      status={load.status ?? undefined}
      actions={
        <Link
          href={home.href}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {home.label}
        </Link>
      }
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-secondary">
              Overview content for this {listId.slice(0, -1)} surfaces here. Module-specific
              tabs (Clinical, Staffing, Finance, Compliance) light up in S10/S11 once
              their backing aggregates land.
            </div>
          ),
        },
        {
          id: "activity",
          label: "Activity",
          content: (
            <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
              No activity recorded for this record yet. The activity timeline reads from
              the module&apos;s audit log; backfill is tracked alongside the per-module
              detail surfaces.
            </div>
          ),
        },
      ]}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: new Date().toISOString(),
      }}
    />
  );
}
