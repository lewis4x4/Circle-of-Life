"use client";

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

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { ADMIN_ELIGIBLE_APP_ROLES } from "@/lib/auth/app-role";

type SettingsCard = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: typeof Users;
  roles: string[];
};

const ADMIN_ELIGIBLE_ROLES = Array.from(ADMIN_ELIGIBLE_APP_ROLES);

const SETTINGS_CARDS: SettingsCard[] = [
  {
    key: "users",
    title: "Users & roles",
    description:
      "Add, edit, or deactivate users. Assign roles and facility access.",
    href: "/admin/settings/users",
    icon: Users,
    roles: ["owner", "org_admin", "facility_admin"],
  },
  {
    key: "notifications",
    title: "Notifications",
    description:
      "Configure how Haven delivers alerts to staff across email, push, and SMS.",
    href: "/admin/settings/notifications",
    icon: Bell,
    roles: ADMIN_ELIGIBLE_ROLES,
  },
  {
    key: "thresholds",
    title: "Thresholds",
    description:
      "Tune clinical and operational thresholds for alerts and escalations.",
    href: "/admin/settings/thresholds",
    icon: Gauge,
    roles: ["owner", "org_admin"],
  },
  {
    key: "search-tools",
    title: "Search tools",
    description:
      "Manage search indexing, scope, and synonyms used across Haven.",
    href: "/admin/settings/search-tools",
    icon: Search,
    roles: ADMIN_ELIGIBLE_ROLES,
  },
  {
    key: "audit-log",
    title: "Audit log",
    description:
      "Review who did what across Haven — clinical, financial, and admin actions.",
    href: "/admin/v2/settings/audit-log",
    icon: ScrollText,
    roles: ["owner", "org_admin", "facility_admin"],
  },
];

export function SettingsHubClient() {
  const { appRole, loading } = useHavenAuth();
  const visibleCards = loading
    ? []
    : SETTINGS_CARDS.filter((card) => card.roles.includes(appRole));

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

      {visibleCards.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">
          {loading ? "Loading settings…" : "No settings are available for your current role."}
        </div>
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visibleCards.map((card) => {
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
      )}

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
