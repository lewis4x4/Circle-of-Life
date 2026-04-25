import { T6Settings, type T6SettingsSection } from "@/design-system/templates";

const SETTINGS_SUBNAV: Array<{
  id: string;
  label: string;
  href: string;
  pathSuffix: string;
}> = [
  { id: "thresholds", label: "Thresholds", href: "/admin/settings/thresholds", pathSuffix: "thresholds" },
  { id: "users", label: "Users & Roles", href: "/admin/settings/users", pathSuffix: "users" },
  { id: "notifications", label: "Notifications", href: "/admin/settings/notifications", pathSuffix: "notifications" },
  { id: "audit-log", label: "Audit log", href: "/admin/settings/audit-log", pathSuffix: "audit-log" },
];

const FIXED_NOW = new Date("2026-04-25T16:00:00-04:00");

export type SettingsShellProps = {
  activeId: string;
  title: string;
  subtitle?: string;
  saveState?: "clean" | "dirty" | "saving" | "error";
  sections: T6SettingsSection[];
  /** ISO timestamp surfaced to the audit footer; defaults to a fixed value to keep render pure. */
  generatedAt?: string;
};

export function SettingsShell({
  activeId,
  title,
  subtitle,
  saveState,
  sections,
  generatedAt = FIXED_NOW.toISOString(),
}: SettingsShellProps) {
  return (
    <T6Settings
      title={title}
      subtitle={subtitle}
      subnav={SETTINGS_SUBNAV.map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        active: item.id === activeId,
      }))}
      sections={sections}
      saveState={saveState}
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: generatedAt,
        now: FIXED_NOW,
      }}
    />
  );
}
