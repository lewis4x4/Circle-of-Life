"use client";

import { T6Settings } from "./T6Settings";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function T6SettingsPreview() {
  return (
    <T6Settings
      title="Org settings"
      subtitle="Circle of Life Holdings"
      subnav={[
        { id: "users", label: "Users & Roles", href: "/admin/settings/users", active: true },
        { id: "thresholds", label: "Thresholds", href: "/admin/settings/thresholds" },
        { id: "branding", label: "Branding", href: "/admin/settings/branding" },
        { id: "billing", label: "Billing", href: "/admin/settings/billing" },
      ]}
      sections={[
        {
          id: "general",
          label: "General",
          description: "Org-wide defaults applied to every facility unless overridden.",
          body: (
            <p className="text-sm text-text-secondary">Default timezone: America/New_York. Locale: en-US.</p>
          ),
        },
        {
          id: "auth",
          label: "Authentication",
          description: "JWT + Supabase auth.",
          body: (
            <p className="text-sm text-text-secondary">SSO providers: none. MFA required for org_admin.</p>
          ),
        },
      ]}
      saveState="dirty"
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: "2026-04-24T15:57:00-04:00",
        now: FIXED_NOW,
      }}
    />
  );
}
