/**
 * Settings Hub — /admin/settings
 *
 * Slice 1 landing page that links to every settings sub-surface in one
 * place. Reached from the user menu (UserMenu / UserMenuSheet) and from
 * direct URL.
 *
 * Subsequent slices (per plan):
 *   - Slice 2: self-service password change on /admin/profile
 *   - Slice 3: admin password reset action on UserEditSheet
 *   - Slice 4: role-based card filtering, ⌘, shortcut, polish
 *   - Slice 5+: net-new sub-pages (organization, integrations, security)
 */

import type { Metadata } from "next";

import { SettingsHubClient } from "./SettingsHubClient";

export const metadata: Metadata = {
  title: "Settings — Haven",
  description: "Manage users, notifications, thresholds, and other Haven settings.",
};

export default function SettingsHubPage() {
  return <SettingsHubClient />;
}
