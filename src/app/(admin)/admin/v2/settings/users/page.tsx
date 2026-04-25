import { notFound } from "next/navigation";

import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { uiV2 } from "@/lib/flags";
import { loadV2Users } from "@/lib/v2-users";

export const dynamic = "force-dynamic";

export default async function SettingsUsersPage() {
  if (!uiV2()) notFound();
  const load = await loadV2Users();

  return (
    <SettingsShell
      activeId="users"
      title="Users & Roles"
      subtitle="Read-only roster from public.user_profiles, RLS-cascading."
      sections={[
        {
          id: "users-roster",
          label: `Users · ${load.rows.length}`,
          description:
            "Editing (invite / role change / deactivate) lives at /admin/settings/users in V1 today; V2 write surface is sequenced behind S11.5.",
          body: load.rows.length === 0 ? (
            <p className="text-xs text-text-muted">No users in scope.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-elevated">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Name</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Email</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Role</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Job title</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Active</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-caps text-text-muted">Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {load.rows.map((user) => (
                    <tr key={user.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-sm text-text-primary">{user.fullName ?? "—"}</td>
                      <td className="px-3 py-2 text-sm text-text-secondary">{user.email ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="inline-flex items-center rounded-sm border border-border bg-surface-elevated px-2 py-0.5 font-semibold text-text-primary">
                          {user.appRole ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary">{user.jobTitle ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {user.isActive ? (
                          <span className="text-success">active</span>
                        ) : (
                          <span className="text-text-muted">inactive</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted">
                        {user.lastLoginAt ? user.lastLoginAt.replace("T", " ").slice(0, 19) : "—"}
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
