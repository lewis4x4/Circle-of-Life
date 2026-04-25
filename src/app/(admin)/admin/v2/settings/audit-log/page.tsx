import { notFound } from "next/navigation";

import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { uiV2 } from "@/lib/flags";
import { loadV2AuditLog } from "@/lib/v2-audit-log";

export const dynamic = "force-dynamic";

export default async function SettingsAuditLogPage() {
  if (!uiV2()) notFound();
  const load = await loadV2AuditLog(100);

  return (
    <SettingsShell
      activeId="audit-log"
      title="Audit log"
      subtitle="Append-only record of UI-V2 alert actions. RLS-cascading; you only see entries for facilities you can read."
      sections={[
        {
          id: "alert-audit-log",
          label: `Alert actions · ${load.totalShown} most recent`,
          description:
            "Sourced from public.alert_audit_log (S2 migration). Other audit surfaces (resident, incident, finance) live in their own tables and surface in their own modules.",
          body: load.rows.length === 0 ? (
            <p className="text-xs text-text-muted">
              No alert audit entries in scope yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-elevated">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">When</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Action</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Alert</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Facility</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Actor</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {load.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 align-top text-xs text-text-muted">
                        <time dateTime={row.createdAt}>
                          {row.createdAt.replace("T", " ").slice(0, 19)}
                        </time>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="inline-flex items-center rounded-sm border border-border bg-surface-elevated px-2 py-0.5 text-xs font-semibold text-text-primary">
                          {row.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-text-secondary">
                        <code>{row.alertId.slice(0, 8)}…</code>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-text-secondary">
                        <code>{row.facilityId?.slice(0, 8) ?? "—"}…</code>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-text-secondary">
                        <code>{row.actorId?.slice(0, 8) ?? "—"}…</code>
                        {row.actorRole && (
                          <span className="ml-2 text-text-muted">{row.actorRole}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-text-secondary">
                        {row.note ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
      ]}
    />
  );
}
