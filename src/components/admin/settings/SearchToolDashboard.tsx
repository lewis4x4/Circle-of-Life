"use client";

import React, { useState, useMemo } from "react";
import {
  Shield,
  Activity,
  Search,
  Clock,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Eye,
  Check,
  X,
  Loader2,
  BarChart3,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useSearchToolPolicies } from "@/hooks/useSearchToolPolicies";
import { useSearchAuditStream } from "@/hooks/useSearchAuditStream";
import {
  SEARCH_TOOLS,
  MATRIX_DISPLAY_ROLES,
  TIER_META,
  type SearchToolTier,
  type SearchAuditEntry,
} from "@/lib/search-tools";
import { ROLE_LABELS } from "@/lib/rbac";
import { cn } from "@/lib/utils";

// ── Sub-components ───────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl transition-all hover:border-white/20 dark:bg-[#0A0A0A]/50">
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${accent}15, transparent 70%)`,
        }}
      />
      <div className="relative z-10 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}15` }}
        >
          <Icon className="h-5 w-5" style={{ color: accent }} />
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white font-mono">
            {value}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: SearchToolTier }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest",
        meta.bgClass,
        meta.textClass,
      )}
    >
      {meta.label}
    </span>
  );
}

function PolicyToggle({
  enabled,
  saving,
  canEdit,
  onToggle,
}: {
  enabled: boolean;
  saving: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  if (!canEdit) {
    return (
      <div className="flex items-center justify-center">
        {enabled ? (
          <Check className="h-4 w-4 text-emerald-500" />
        ) : (
          <X className="h-4 w-4 text-slate-300 dark:text-slate-600" />
        )}
      </div>
    );
  }

  return (
    <button
      onClick={onToggle}
      disabled={saving}
      className={cn(
        "group/toggle relative flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200",
        enabled
          ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500"
          : "bg-slate-100/50 hover:bg-slate-200/50 text-slate-300 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 dark:text-slate-600",
        saving && "opacity-50 cursor-wait",
      )}
    >
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : enabled ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <X className="h-3.5 w-3.5 group-hover/toggle:text-slate-500 dark:group-hover/toggle:text-slate-400" />
      )}
    </button>
  );
}

function AuditRow({ entry }: { entry: SearchAuditEntry }) {
  const meta = TIER_META[entry.tool_tier];
  const toolDef = SEARCH_TOOLS.find((t) => t.name === entry.tool_name);
  const roleLabel = ROLE_LABELS[entry.app_role] ?? entry.app_role;
  const timeAgo = getTimeAgo(entry.created_at);

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all hover:border-white/10 hover:bg-white/5 dark:hover:bg-white/[0.02]">
      {/* Pulse indicator */}
      <div className="relative flex-shrink-0">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: meta.color }}
        />
        <div
          className="absolute inset-0 h-2 w-2 animate-ping rounded-full opacity-75"
          style={{ backgroundColor: meta.color }}
        />
      </div>

      {/* Tool + query */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {toolDef?.label ?? entry.tool_name}
          </span>
          <TierBadge tier={entry.tool_tier} />
        </div>
        {entry.query_text && (
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400 font-mono">
            &quot;{entry.query_text}&quot;
          </p>
        )}
      </div>

      {/* User */}
      <div className="hidden flex-shrink-0 text-right sm:block">
        <p className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
          {entry.user_email ?? "Unknown"}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          {roleLabel}
        </p>
      </div>

      {/* Results + timing */}
      <div className="flex-shrink-0 text-right">
        <p className="text-xs font-mono text-slate-600 dark:text-slate-300">
          {entry.results_count} results
        </p>
        <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          {entry.duration_ms != null && (
            <>
              <Zap className="h-2.5 w-2.5" />
              <span>{entry.duration_ms}ms</span>
              <span className="mx-0.5">·</span>
            </>
          )}
          <Clock className="h-2.5 w-2.5" />
          <span>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export function SearchToolDashboard() {
  const { appRole, organizationId, loading: authLoading } = useHavenAuth();

  const canEdit = appRole === "owner" || appRole === "org_admin";
  const {
    policyMap,
    loading: policiesLoading,
    saving,
    error: policiesError,
    togglePolicy,
    seedDefaults,
    reload: reloadPolicies,
  } = useSearchToolPolicies(organizationId);

  const {
    entries,
    stats,
    loading: auditLoading,
    error: auditError,
    reload: reloadAudit,
  } = useSearchAuditStream(organizationId);

  const [filterTool, setFilterTool] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(
    new Set(["kb_documents", "clinical", "operational", "financial", "payroll"]),
  );

  // Group tools by tier for the matrix
  const toolsByTier = useMemo(() => {
    const grouped: Record<SearchToolTier, typeof SEARCH_TOOLS> = {
      kb_documents: [],
      clinical: [],
      operational: [],
      financial: [],
      payroll: [],
    };
    for (const tool of SEARCH_TOOLS) {
      grouped[tool.tier].push(tool);
    }
    return grouped;
  }, []);

  // Filter audit entries
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (filterTool !== "all" && e.tool_name !== filterTool) return false;
      if (filterRole !== "all" && e.app_role !== filterRole) return false;
      if (
        searchQuery &&
        !e.query_text?.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !e.user_email?.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    });
  }, [entries, filterTool, filterRole, searchQuery]);

  const toggleTier = (tier: string) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-50/60 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
        Search tool governance requires an active organization context.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Search Tool Access
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage which roles can access each search tool and monitor usage in
            real-time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-mono uppercase tracking-widest"
              onClick={seedDefaults}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Shield className="mr-2 h-3 w-3" />
              )}
              Seed Defaults
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs font-mono uppercase tracking-widest"
            onClick={() => {
              reloadPolicies();
              reloadAudit();
            }}
          >
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Last 5 min"
          value={stats.last5min}
          icon={Zap}
          accent="#8b5cf6"
        />
        <StatCard
          label="Last hour"
          value={stats.last1hr}
          icon={Activity}
          accent="#06b6d4"
        />
        <StatCard
          label="Avg latency"
          value={`${stats.avgDuration}ms`}
          icon={Clock}
          accent="#f59e0b"
        />
        <StatCard
          label="Total loaded"
          value={stats.totalLoaded}
          icon={BarChart3}
          accent="#10b981"
        />
      </div>

      {/* ── Error banner ────────────────────────────────── */}
      {(policiesError || auditError) && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {policiesError ?? auditError}
        </div>
      )}

      {/* ── RBAC Matrix ─────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl dark:bg-[#0A0A0A]/50">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-700 dark:text-slate-300">
            Access Control Matrix
          </h3>
          {canEdit && (
            <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Click to toggle
            </span>
          )}
        </div>

        {policiesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="pb-3 text-left text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500 w-[200px]">
                    Tool
                  </th>
                  <th className="pb-3 text-left text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500 w-[100px]">
                    Tier
                  </th>
                  {MATRIX_DISPLAY_ROLES.map((role) => (
                    <th
                      key={role}
                      className="pb-3 text-center text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500 min-w-[70px]"
                    >
                      {ROLE_LABELS[role]?.split(" ")[0] ?? role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  Object.entries(toolsByTier) as [
                    SearchToolTier,
                    typeof SEARCH_TOOLS,
                  ][]
                ).map(([tier, tools]) => {
                  if (tools.length === 0) return null;
                  const isExpanded = expandedTiers.has(tier);
                  const meta = TIER_META[tier];

                  return (
                    <React.Fragment key={tier}>
                      {/* Tier group header */}
                      <tr>
                        <td colSpan={2 + MATRIX_DISPLAY_ROLES.length}>
                          <button
                            onClick={() => toggleTier(tier)}
                            className="flex w-full items-center gap-2 rounded-lg py-2 text-left transition-colors hover:bg-white/5"
                          >
                            {isExpanded ? (
                              <ChevronDown
                                className="h-3.5 w-3.5"
                                style={{ color: meta.color }}
                              />
                            ) : (
                              <ChevronRight
                                className="h-3.5 w-3.5"
                                style={{ color: meta.color }}
                              />
                            )}
                            <span
                              className="text-xs font-semibold uppercase tracking-widest"
                              style={{ color: meta.color }}
                            >
                              {meta.label}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              ({tools.length} tool{tools.length > 1 ? "s" : ""})
                            </span>
                          </button>
                        </td>
                      </tr>

                      {/* Tool rows */}
                      {isExpanded &&
                        tools.map((tool) => (
                          <tr
                            key={tool.name}
                            className="group/row border-t border-white/5 transition-colors hover:bg-white/[0.02]"
                          >
                            <td className="py-2.5 pr-3">
                              <div>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                  {tool.label}
                                </p>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                  {tool.name}
                                </p>
                              </div>
                            </td>
                            <td className="py-2.5">
                              <TierBadge tier={tool.tier} />
                            </td>
                            {MATRIX_DISPLAY_ROLES.map((role) => (
                              <td key={role} className="py-2.5 text-center">
                                <PolicyToggle
                                  enabled={
                                    policyMap[tool.name]?.[role] ?? false
                                  }
                                  saving={saving}
                                  canEdit={canEdit}
                                  onToggle={() =>
                                    togglePolicy(tool.name, role)
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Live Activity Feed ──────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl dark:bg-[#0A0A0A]/50">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity className="h-4 w-4 text-emerald-500" />
              <div className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-700 dark:text-slate-300">
              Live Search Activity
            </h3>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200/50 bg-white/50 px-2.5 dark:border-slate-800/50 dark:bg-black/40 backdrop-blur-sm">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                className="h-8 w-32 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 font-mono"
              />
            </div>

            <select
              value={filterTool}
              onChange={(e) => setFilterTool(e.target.value)}
              className="h-8 rounded-xl border border-slate-200/50 bg-white/60 px-2 text-xs text-slate-700 dark:border-slate-800/60 dark:bg-black/40 dark:text-slate-300 font-mono"
            >
              <option value="all">All tools</option>
              {SEARCH_TOOLS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="h-8 rounded-xl border border-slate-200/50 bg-white/60 px-2 text-xs text-slate-700 dark:border-slate-800/60 dark:bg-black/40 dark:text-slate-300 font-mono"
            >
              <option value="all">All roles</option>
              {MATRIX_DISPLAY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>
        </div>

        {auditLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100/50 dark:bg-slate-800/50">
              <Eye className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              No search activity yet
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Searches will appear here in real-time as users query the system.
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredEntries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default SearchToolDashboard;
