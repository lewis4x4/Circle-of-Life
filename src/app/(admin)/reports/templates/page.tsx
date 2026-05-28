"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";

import { SourceReadinessCallout } from "@/components/common/source-readiness-callout";
import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { TemplateCard } from "@/components/reports/template-card";
import { Input } from "@/components/ui/input";
import { REPORTING_SOURCE_READINESS } from "@/lib/reporting-source-readiness";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import {
  parsePinnedTemplateIds,
  togglePinnedTemplateId as prefsTogglePinnedTemplateId,
} from "@/lib/reports/hub-preferences";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";

type DbTemplateRow = {
  id: string;
  slug: string;
  created_at: string;
  short_description: string | null;
};

type ScheduleRow = {
  source_type: string;
  source_id: string;
  recurrence_rule: string;
  status: string;
};

type RunRow = {
  template_id: string;
  started_at: string;
};

type EnrichedRow = (typeof PHASE1_TEMPLATE_SEED)[number] & {
  templateId: string | null;
  createdAtIso: string | null;
  lastRunRelative: string | null;
  scheduledSummary: string | null;
  isNew: boolean;
};

function scheduleMatchesTemplate(sourceId: string, templateId: string | null, slug: string): boolean {
  const sid = sourceId.trim();
  if (templateId && sid === templateId) return true;
  return sid === slug;
}

function humanizeRecurrence(rule: string): string {
  const lower = rule.trim().toLowerCase();
  const known: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
  };
  if (known[lower]) return known[lower];
  const raw = rule.trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "Recurring";
}

function deriveScheduledSummary(schedules: ScheduleRow[], templateId: string | null, slug: string): string | null {
  const rows = schedules.filter(
    (s) => s.source_type === "template" && scheduleMatchesTemplate(s.source_id, templateId, slug),
  );
  const active = rows.find((s) => s.status === "active");
  const paused = rows.find((s) => s.status === "paused");
  const pick = active ?? paused;
  if (!pick) return null;
  const cadence = humanizeRecurrence(pick.recurrence_rule);
  return active ? `Scheduled — ${cadence}` : `Paused — ${cadence}`;
}

const NEW_TEMPLATE_DAYS = 14;

export default function ReportTemplatesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [currentSettings, setCurrentSettings] = useState<Json | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      const uId = ctx.ctx.userId;
      const orgId = ctx.ctx.organizationId;
      setUserId(uId);

      const slugs = PHASE1_TEMPLATE_SEED.map((t) => t.slug);

      const [profileRes, templatesRes, runsRes, schedulesRes] = await Promise.all([
        supabase.from("user_profiles").select("settings").eq("id", uId).maybeSingle(),
        supabase
          .from("report_templates")
          .select("id, slug, created_at, short_description")
          .eq("status", "active")
          .in("slug", slugs),
        supabase
          .from("report_runs")
          .select("template_id, started_at")
          .eq("organization_id", orgId)
          .eq("generated_by_user_id", uId)
          .not("template_id", "is", null)
          .order("started_at", { ascending: false })
          .limit(800),
        supabase
          .from("report_schedules")
          .select("source_type, source_id, recurrence_rule, status")
          .eq("organization_id", orgId)
          .is("deleted_at", null),
      ]);

      const err =
        profileRes.error ?? templatesRes.error ?? runsRes.error ?? schedulesRes.error ?? null;
      if (err) throw new Error(err.message);

      const settings = profileRes.data?.settings ?? null;
      setCurrentSettings(settings);

      const dbRows = (templatesRes.data ?? []) as DbTemplateRow[];
      const dbBySlug = new Map(dbRows.map((r) => [r.slug, r]));

      const lastRunIsoByTemplateId = new Map<string, string>();
      for (const run of (runsRes.data ?? []) as RunRow[]) {
        if (!run.template_id) continue;
        if (!lastRunIsoByTemplateId.has(run.template_id)) {
          lastRunIsoByTemplateId.set(run.template_id, run.started_at);
        }
      }

      const scheduleRows = (schedulesRes.data ?? []) as ScheduleRow[];

      const now = Date.now();
      const enriched: EnrichedRow[] = PHASE1_TEMPLATE_SEED.map((seed) => {
        const db = dbBySlug.get(seed.slug);
        const templateId = db?.id ?? null;
        const createdAtIso = db?.created_at ?? null;
        let isNew = false;
        if (createdAtIso) {
          const ageMs = now - new Date(createdAtIso).getTime();
          isNew = ageMs >= 0 && ageMs <= NEW_TEMPLATE_DAYS * 86400000;
        }

        let lastRunRelative: string | null = null;
        const iso = templateId ? lastRunIsoByTemplateId.get(templateId) : undefined;
        if (iso) {
          lastRunRelative = formatDistanceToNow(new Date(iso), { addSuffix: true });
        }

        const scheduledSummary = deriveScheduledSummary(scheduleRows, templateId, seed.slug);

        const description = db?.short_description?.trim() || seed.description;

        return {
          ...seed,
          description,
          templateId,
          createdAtIso,
          lastRunRelative,
          scheduledSummary,
          isNew,
        };
      });

      setRows(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates.");
      setRows(
        PHASE1_TEMPLATE_SEED.map((seed) => ({
          ...seed,
          templateId: null,
          createdAtIso: null,
          lastRunRelative: null,
          scheduledSummary: null,
          isNew: false,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pinnedIds = useMemo(() => new Set(parsePinnedTemplateIds(currentSettings)), [currentSettings]);

  const togglePinned = useCallback(
    async (templateId: string) => {
      if (!userId || !templateId) return;
      setPinBusyId(templateId);
      try {
        const nextSettings = prefsTogglePinnedTemplateId(currentSettings, templateId);
        const { error: upErr } = await supabase
          .from("user_profiles")
          .update({ settings: nextSettings })
          .eq("id", userId);
        if (upErr) throw new Error(upErr.message);
        setCurrentSettings(nextSettings);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update pinned templates.");
      } finally {
        setPinBusyId(null);
      }
    },
    [supabase, userId, currentSettings],
  );

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(PHASE1_TEMPLATE_SEED.map((template) => template.category)))],
    [],
  );

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter((template) => {
      if (category !== "all" && template.category !== category) return false;
      if (!q) return true;
      return (
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.slug.toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      const ap = !!(a.templateId && pinnedIds.has(a.templateId));
      const bp = !!(b.templateId && pinnedIds.has(b.templateId));
      if (ap !== bp) return ap ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [rows, category, query, pinnedIds]);

  const totalCatalog = PHASE1_TEMPLATE_SEED.length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <div className="relative z-10 w-full space-y-6">
        <div className="mt-4">
          <ReportsHubNav />
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Template library</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {totalCatalog} templates available. Search by name or filter by category.
          </p>
        </header>

        <SourceReadinessCallout copy={REPORTING_SOURCE_READINESS} />

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <Input
            placeholder="Search templates by name or keyword"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-lg md:max-w-xl"
            aria-label="Search templates"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-full rounded-lg md:w-72" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All categories" : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading templates…</p>
        ) : filteredSorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="text-base font-medium text-foreground">No templates match</p>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting search or category filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredSorted.map((template) => (
              <TemplateCard
                key={template.slug}
                slug={template.slug}
                templateId={template.templateId}
                name={template.name}
                audience={template.audience}
                description={template.description}
                category={template.category}
                defaultRange={template.defaultRange}
                isNew={template.isNew}
                isPinned={template.templateId ? pinnedIds.has(template.templateId) : false}
                pinDisabled={!template.templateId}
                pinBusy={template.templateId === pinBusyId}
                onTogglePin={() => {
                  if (!template.templateId) return;
                  void togglePinned(template.templateId);
                }}
                lastRunRelative={template.lastRunRelative}
                scheduledSummary={template.scheduledSummary}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
