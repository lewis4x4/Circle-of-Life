"use client";

/**
 * Enhanced Executive Navigation System
 *
 * Dual navigation system for executive dashboards:
 * - Top navigation: Major domains (Command, Pipeline, Clinical Ops, Quality & Risk, Knowledge, Workforce, Finance)
 * - Pill menu: Executive view switching within domain (Overview, CEO View, CFO View, COO View, Alerts, Reports, Benchmarks, Haven Insight)
 *
 * Quiet Operator treatment: solid bg-card surfaces, semantic token borders,
 * no glass/blur. Active pill uses bg-secondary + left-bar accent via border-l-2.
 */

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Zap,
  Briefcase,
  Activity,
  Shield,
  LayoutTemplate,
  Heart,
  DollarSign,
} from "lucide-react";
import { HavenShellBrandLink } from "@/components/layout/HavenShellBrandLink";
import { cn } from "@/lib/utils";

// ── TOP NAVIGATION TABS ──

const topNavTabs = [
  { id: "command", label: "Command", icon: Zap, href: "/admin/executive/ceo" },
  { id: "pipeline", label: "Pipeline", icon: Briefcase, href: "/admin/referrals" },
  {
    id: "clinical",
    label: "Clinical Ops",
    icon: Activity,
    href: "/admin/daily-ops",
  },
  {
    id: "quality",
    label: "Quality & Risk",
    icon: Shield,
    href: "/admin/incidents",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: LayoutTemplate,
    href: "/admin",
  },
  {
    id: "workforce",
    label: "Workforce",
    icon: Heart,
    href: "/admin/staff",
  },
  {
    id: "finance",
    label: "Finance",
    icon: DollarSign,
    href: "/admin/billing",
  },
] as const;

// ── PILL MENU TABS ──

const pillMenuTabs = [
  "Overview",
  "CEO View",
  "CFO View",
  "COO View",
  "Alerts",
  "Reports",
  "Benchmarks",
  "Haven Insight",
] as const;

// ── COMPONENTS ──

export interface ExecutiveNavV2Props {
  /** Currently active top nav tab ID */
  activeTopNav?: string;
  /** Currently active pill menu tab */
  activePillMenu?: string;
  /** Callback when top nav tab changes */
  onTopNavChange?: (tabId: string) => void;
  /** Callback when pill menu tab changes */
  onPillMenuChange?: (tab: string) => void;
  /** Custom pill tabs override (per-role tab set) */
  customPillTabs?: string[];
  /** Show/hide top navigation */
  showTopNav?: boolean;
  /** Show/hide pill menu */
  showPillMenu?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Enhanced dual navigation system for executive dashboards
 */
export function ExecutiveNavV2({
  activeTopNav = "command",
  activePillMenu = "CEO View",
  onTopNavChange,
  onPillMenuChange,
  customPillTabs,
  showTopNav = true,
  showPillMenu = true,
  className,
}: ExecutiveNavV2Props) {
  const tabs = customPillTabs ?? (pillMenuTabs as unknown as string[]);
  return (
    <div className={cn("flex flex-col gap-0", className)}>
      {showTopNav && <TopNavigation activeTab={activeTopNav} onTabChange={onTopNavChange} />}
      {showPillMenu && <PillMenu activeTab={activePillMenu} onTabChange={onPillMenuChange} tabs={tabs} />}
    </div>
  );
}

// ── TOP NAVIGATION COMPONENT ──

interface TopNavigationProps {
  activeTab: string;
  onTabChange?: (tabId: string) => void;
}

function TopNavigation({ activeTab, onTabChange }: TopNavigationProps) {
  const pathname = usePathname();

  return (
    <div className="flex items-center bg-card border-b border-border px-4 sm:px-6 h-12 gap-6">
      <HavenShellBrandLink
        href="/admin/executive"
        aria-label="Haven — executive home"
        className={cn(
          "mr-4 shrink-0 pr-4 text-foreground transition-opacity hover:opacity-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      />

      {/* Navigation Tabs */}
      {topNavTabs.map((tab) => {
        const isActive = tab.id === activeTab || pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            onClick={() => onTabChange?.(tab.id)}
            className={cn(
              "flex items-center gap-2 text-sm font-semibold h-full transition-all duration-[var(--motion-duration-micro)] border-b-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── PILL MENU COMPONENT ──

/** Pill tabs that should navigate to a different route instead of calling onTabChange */
const PILL_LINKS: Record<string, string> = {
  "Overview": "/admin/executive",
  "CEO View": "/admin/executive/ceo",
  "CFO View": "/admin/executive/cfo",
  "COO View": "/admin/executive/coo",
};

interface PillMenuProps {
  activeTab: string;
  onTabChange?: (tab: string) => void;
  tabs: string[];
}

function PillMenu({ activeTab, onTabChange, tabs }: PillMenuProps) {
  return (
    // Solid bg-card container with semantic border; rounded-[var(--radius)] matches Dashboard 10px
    <div className="flex flex-wrap items-center bg-card border border-border rounded-[var(--radius)] px-1 py-1 gap-1">
      {tabs.map((tab) => {
        const href = PILL_LINKS[tab];
        const isActive = activeTab === tab;
        // Active: solid bg-secondary + 2px brand-primary left accent bar
        const cls = cn(
          "px-4 py-1.5 rounded-[calc(var(--radius)-2px)] text-xs font-semibold transition-all duration-[var(--motion-duration)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive
            ? "bg-secondary text-foreground border-l-2 border-primary pl-[calc(1rem-2px)]"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        );
        if (href) {
          return (
            <Link key={tab} href={href} className={cls}>
              {tab}
            </Link>
          );
        }
        return (
          <button key={tab} onClick={() => onTabChange?.(tab)} className={cls}>
            {tab}
          </button>
        );
      })}
    </div>
  );
}

// ── EXPORTS ──

export default ExecutiveNavV2;
