/**
 * Settings Hub — /admin/settings
 *
 * Slice 1 landing page that links to every settings sub-surface in one
 * place. Reached from the user menu (UserMenu / UserMenuSheet) and from
 * direct URL. Each sub-page already has its own permission gating, so
 * this hub is intentionally permissive — cards visually advertise the
 * destination, and the destination itself enforces access.
 *
 * Subsequent slices (per plan):
 *   - Slice 2: self-service password change on /admin/profile
 *   - Slice 3: admin password reset action on UserEditSheet
 *   - Slice 4: role-based card filtering, ⌘, shortcut, polish
 *   - Slice 5+: net-new sub-pages (organization, integrations, security)
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  Gauge,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Settings — Haven",
  description: "Manage users, notifications, thresholds, and other Haven settings.",
};

type SettingsCard = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: typeof Users;
};

const SETTINGS_CARDS: SettingsCard[] = [
  {
    key: "users",
    title: "Users & roles",
    description:
      "Add, edit, or deactivate users. Assign roles and facility access.",
    href: "/admin/settings/users",
    icon: Users,
  },
  {
    key: "notifications",
    title: "Notifications",
    description:
      "Configure how Haven delivers alerts to staff across email, push, and SMS.",
    href: "/admin/settings/notifications",
    icon: Bell,
  },
  {
    key: "thresholds",
    title: "Thresholds",
    description:
      "Tune clinical and operational thresholds for alerts and escalations.",
    href: "/admin/settings/thresholds",
    icon: Gauge,
  },
  {
    key: "search-tools",
    title: "Search tools",
    description:
      "Manage search indexing, scope, and synonyms used across Haven.",
    href: "/admin/settings/search-tools",
    icon: Search,
  },
  {
    key: "audit-log",
    title: "Audit log",
    description:
      "Review who did what across Haven — clinical, financial, and admin actions.",
    href: "/admin/v2/settings/audit-log",
    icon: ScrollText,
  },
];

export default function SettingsHubPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <SettingsIcon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users, notification routing, thresholds, and other
            organization-wide configuration.
          </p>
        </div>
      </header>

      <ul
        role="list"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {SETTINGS_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <li key={card.key}>
              <Link
                href={card.href}
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
                  >
                    <Icon className="size-4" />
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </div>
                <h2 className="text-base font-semibold text-foreground">
                  {card.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-muted-foreground">
        Looking for something else? See{" "}
        <Link
          href="/admin/profile"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          My profile
        </Link>{" "}
        for personal settings, or{" "}
        <Link
          href="/admin/facilities"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Facilities
        </Link>{" "}
        to manage buildings and entities.
      </p>
    </div>
  );
}
