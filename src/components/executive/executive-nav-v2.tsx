"use client";

/**
 * Enhanced Executive Navigation System
 *
 * Dual navigation system for executive dashboards:
 * - Top navigation: Major domains (Command, Pipeline, Clinical Ops, Quality & Risk, Knowledge, Workforce, Finance)
 * - Pill menu: Executive view switching within domain (Overview, CEO View, CFO View, COO View, Alerts, Reports, Benchmarks, Haven Insight)
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

type PillMenuTab = (typeof pillMenuTabs)[number];

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
    <div className="flex items-center bg-slate-900/50 backdrop-blur-xl border-b border-white/5 px-4 sm:px-6 h-12 gap-6">
      {/* Haven Brand */}
      <Link href="/admin/executive" className="flex items-center gap-3 mr-4 group">
        <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-sm group-hover:bg-indigo-400 transition-colors">
          H
        </div>
        <span className="font-bold text-slate-100 text-base group-hover:text-white transition-colors">
          Haven
        </span>
      </Link>

      {/* Navigation Tabs */}
      {topNavTabs.map((tab) => {
        const isActive = tab.id === activeTab || pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            onClick={() => onTabChange?.(tab.id)}
            className={cn(
              "flex items-center gap-2 text-sm font-semibold h-full transition-all duration-200 border-b-2",
              isActive
                ? "text-white border-indigo-400"
                : "text-slate-400 border-transparent hover:text-slate-200"
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
    <div className="flex flex-wrap items-center bg-white/[0.03] border border-white/5 rounded-full px-1 py-1 gap-1">
      {tabs.map((tab) => {
        const href = PILL_LINKS[tab];
        const cls = cn(
          "px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-300",
          activeTab === tab
            ? "bg-white/10 text-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
            : "text-slate-400 hover:text-white"
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
