"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

export type ResidentDetailTabId = "overview" | "assessments" | "care-plan" | "medications" | "vitals" | "billing";

export type ResidentDetailHrefConfig = {
  rosterHref: string;
  residentRootHref: string;
  overviewHref: string;
  assessmentsHref: string;
  carePlanHref: string;
  medicationsHref: string;
  vitalsHref: string;
  billingHref: string;
};

export function ResidentDetailTabStrip(props: {
  active: ResidentDetailTabId;
  hrefs: ResidentDetailHrefConfig;
}) {
  const { active, hrefs } = props;

  const tabs: Array<{ id: ResidentDetailTabId; label: string; href: string }> = [
    { id: "overview", label: "Overview", href: hrefs.overviewHref },
    { id: "assessments", label: "Assessments", href: hrefs.assessmentsHref },
    { id: "care-plan", label: "Care plan", href: hrefs.carePlanHref },
    { id: "medications", label: "Medications", href: hrefs.medicationsHref },
    { id: "vitals", label: "Vitals", href: hrefs.vitalsHref },
    { id: "billing", label: "Billing", href: hrefs.billingHref },
  ];

  return (
    <nav
      aria-label="Resident workspace"
      className="scrollbar-hide flex gap-1 overflow-x-auto rounded-lg bg-muted/40 p-1 ring-1 ring-border/60"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            prefetch={false}
            href={tab.href}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border border-transparent bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
            {isActive ? (
              <span className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
