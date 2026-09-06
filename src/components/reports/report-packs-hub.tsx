"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Zap } from "lucide-react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchActiveTemplatesBySlug, orderTemplateIdsBySlugOrder } from "@/lib/reports/fetch-templates-by-slug";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import {
  mergePackNotes,
  packDbCategory,
  parsePackNotes,
  labelPackType,
  type EventTrigger,
  type PackUiKind,
  type PackUiMeta,
  type ScheduleFrequency,
} from "@/lib/reports/pack-ui-metadata";
import {
  buildRecommendedStarterPacks,
  SURVEY_VISIT_PACK_NAME,
  surveyVisitTemplateSlugs,
} from "@/lib/reports/recommended-packs";
import {
  computeNextRunUtc,
  estimatePdfPages,
  encodeScheduleRule,
} from "@/lib/reports/schedule-preview";
import { formatReportPackCadenceSummary } from "@/lib/reports/reports-display-copy";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PackRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  official_pack: boolean;
  locked_definition: boolean;
  active: boolean;
  created_at: string;
  notes: string | null;
};

type ScheduleRow = {
  id: string;
  source_id: string;
  recurrence_rule: string;
  timezone: string;
  status: string;
  next_run_at: string | null;
};

const TZ_DEFAULT = "America/New_York";

const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

const EVENT_TRIGGER_OPTIONS: { value: EventTrigger; label: string }[] = [
  { value: "surveyor_arrival", label: "Surveyor arrival" },
  { value: "board_prep", label: "Board meeting prep" },
  { value: "manual_only", label: "Manual only" },
];

const PACK_KIND_COPY: { id: PackUiKind; title: string; description: string }[] = [
  {
    id: "operational",
    title: "Operational",
    description: "Recurring bundles on a schedule. Best for ongoing leadership reports.",
  },
  {
    id: "role_based",
    title: "Role-based",
    description: "Tailored to a specific role's information needs. Best for CEO weekly or Administrator daily.",
  },
  {
    id: "event_based",
    title: "Event-based",
    description: "Triggered by a specific event like surveyor arrival or board prep. No recurring schedule.",
  },
];

function starterMarker(starterId: string) {
  return `[starter:${starterId}]`;
}

function surveyVisitMarker(desc: string | null | undefined) {
  return desc?.startsWith("[survey_visit_pack]") ?? false;
}

export function ReportPacksHub() {
  const router = useRouter();
  const supabase = createClient();

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [schedulesByPackId, setSchedulesByPackId] = useState<Map<string, ScheduleRow>>(new Map());
  const [countsByPackId, setCountsByPackId] = useState<Map<string, number>>(new Map());
  const [slugByTemplateId, setSlugByTemplateId] = useState<Map<string, string>>(new Map());

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  const [orgUsers, setOrgUsers] = useState<{ id: string; full_name: string }[]>([]);

  const [customOpen, setCustomOpen] = useState(false);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [packKind, setPackKind] = useState<PackUiKind>("operational");
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(() => new Set());

  const [frequency, setFrequency] = useState<ScheduleFrequency>("weekly");
  const [weekday, setWeekday] = useState("1");
  const [timeLocal, setTimeLocal] = useState("08:00");
  const [eventTrigger, setEventTrigger] = useState<EventTrigger>("manual_only");
  const [deliveryDestination] = useState<"in_app">("in_app");
  const [failureAlertUserId, setFailureAlertUserId] = useState<string>("");

  const [surveyDialogOpen, setSurveyDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PackRow | null>(null);

  const [sortKey, setSortKey] = useState<"name" | "cadence" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const templatesByCategory = useMemo(() => {
    const map = new Map<string, typeof PHASE1_TEMPLATE_SEED>();
    for (const t of PHASE1_TEMPLATE_SEED) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const recommended = useMemo(() => buildRecommendedStarterPacks(PHASE1_TEMPLATE_SEED), []);

  const toggleSlug = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const resetCustomForm = useCallback(() => {
    setEditingPackId(null);
    setName("");
    setPackKind("operational");
    setSelectedSlugs(new Set());
    setFrequency("weekly");
    setWeekday("1");
    setTimeLocal("08:00");
    setEventTrigger("manual_only");
    setFailureAlertUserId(userId ?? "");
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const oid = ctx.ctx.organizationId;
      const uid = ctx.ctx.userId;
      setOrgId(oid);
      setUserId(uid);
      setCanManage(canManageReports(ctx.ctx.appRole));
      setFailureAlertUserId((cur) => cur || uid);

      const [{ data: packRows, error: packErr }, { data: tplRows, error: tplErr }] = await Promise.all([
        supabase
          .from("report_packs")
          .select(
            "id, name, description, category, official_pack, locked_definition, active, created_at, notes",
          )
          .eq("organization_id", oid)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_templates")
          .select("id, slug")
          .eq("status", "active")
          .is("deleted_at", null)
          .or(`organization_id.eq.${oid},organization_id.is.null`),
      ]);

      if (packErr) throw new Error(packErr.message);
      if (tplErr) throw new Error(tplErr.message);

      const tplMap = new Map((tplRows ?? []).map((r) => [(r as { id: string }).id, (r as { slug: string }).slug]));
      setSlugByTemplateId(tplMap);

      const plist = (packRows ?? []) as PackRow[];
      setPacks(plist);

      const packIds = plist.map((p) => p.id);
      const schMap = new Map<string, ScheduleRow>();
      if (packIds.length > 0) {
        const { data: schRows, error: schErr } = await supabase
          .from("report_schedules")
          .select("id, source_id, recurrence_rule, timezone, status, next_run_at")
          .eq("organization_id", oid)
          .eq("source_type", "pack")
          .in("source_id", packIds)
          .is("deleted_at", null);
        if (schErr) throw new Error(schErr.message);
        for (const row of (schRows ?? []) as ScheduleRow[]) {
          schMap.set(row.source_id, row);
        }
      }
      setSchedulesByPackId(schMap);

      const countMap = new Map<string, number>();
      if (packIds.length > 0) {
        const { data: itemRows, error: itemErr } = await supabase
          .from("report_pack_items")
          .select("pack_id")
          .eq("organization_id", oid)
          .in("pack_id", packIds)
          .is("deleted_at", null);
        if (itemErr) throw new Error(itemErr.message);
        for (const row of itemRows ?? []) {
          const pid = (row as { pack_id: string }).pack_id;
          countMap.set(pid, (countMap.get(pid) ?? 0) + 1);
        }
      }
      setCountsByPackId(countMap);

      const { data: usersRows, error: usersErr } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .eq("organization_id", oid)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name", { ascending: true })
        .limit(200);
      if (!usersErr && usersRows) {
        setOrgUsers(usersRows as { id: string; full_name: string }[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load packs.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewMeta = useMemo((): PackUiMeta => {
    return {
      pack_kind: packKind,
      frequency: packKind === "event_based" ? undefined : frequency,
      weekday: packKind === "event_based" ? undefined : Number.parseInt(weekday, 10),
      time_local: packKind === "event_based" ? undefined : timeLocal,
      timezone: TZ_DEFAULT,
      event_trigger: packKind === "event_based" ? eventTrigger : null,
      delivery_destination: deliveryDestination,
      failure_alert_user_id: failureAlertUserId || null,
    };
  }, [deliveryDestination, eventTrigger, failureAlertUserId, frequency, packKind, timeLocal, weekday]);

  const previewNextRunIso = (() => {
    if (packKind === "event_based") return null;
    try { return computeNextRunUtc({ frequency, weekday: Number.parseInt(weekday, 10), monthDay: 1, timeLocal, timezone: TZ_DEFAULT }).toISOString(); }
    catch { return null; }
  })();

  const selectedOrderedSlugs = useMemo(() => {
    const order = PHASE1_TEMPLATE_SEED.map((t) => t.slug);
    return order.filter((s) => selectedSlugs.has(s));
  }, [selectedSlugs]);

  const singleTemplateWarn = selectedOrderedSlugs.length === 1;

  async function replacePackItems(packId: string, organizationId: string, orderedTemplateIds: string[]) {
    const nowIso = new Date().toISOString();
    const { error: softErr } = await supabase
      .from("report_pack_items")
      .update({ deleted_at: nowIso })
      .eq("pack_id", packId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    if (softErr) throw new Error(softErr.message);

    if (orderedTemplateIds.length === 0) return;
    const rows = orderedTemplateIds.map((tid, idx) => ({
      organization_id: organizationId,
      pack_id: packId,
      source_type: "template" as const,
      source_id: tid,
      display_order: idx,
    }));
    const { error: insErr } = await supabase.from("report_pack_items").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  async function syncPackSchedule(opts: {
    organizationId: string;
    userUid: string;
    packId: string;
    packKind: PackUiKind;
    frequency: ScheduleFrequency;
    weekday: number;
    timeLocal: string;
    timezone: string;
    failureRecipientUserId: string;
  }) {
    const {
      organizationId,
      userUid,
      packId,
      packKind,
      frequency,
      weekday,
      timeLocal,
      timezone,
      failureRecipientUserId,
    } = opts;

    const nowIso = new Date().toISOString();

    const { data: existingRows } = await supabase
      .from("report_schedules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_type", "pack")
      .eq("source_id", packId)
      .is("deleted_at", null);

    if (packKind === "event_based") {
      for (const row of existingRows ?? []) {
        const sid = (row as { id: string }).id;
        await supabase.from("report_schedule_recipients").update({ deleted_at: nowIso }).eq("schedule_id", sid);
        await supabase.from("report_schedules").update({ deleted_at: nowIso, status: "paused" }).eq("id", sid);
      }
      return;
    }

    const recurrence_rule = encodeScheduleRule({ frequency, weekday, monthDay: 1, timeLocal });
    const next_run_at = computeNextRunUtc({
      frequency,
      weekday,
      timeLocal,
      timezone,
      monthDay: 1,
    }).toISOString();

    let scheduleId: string | null = null;
    if (existingRows && existingRows.length > 0) {
      scheduleId = (existingRows[0] as { id: string }).id;
      const { error: upErr } = await supabase
        .from("report_schedules")
        .update({
          recurrence_rule,
          output_format: "csv",
          timezone,
          next_run_at,
          status: "active",
          updated_by: userUid,
          deleted_at: null,
          last_error: null,
        })
        .eq("id", scheduleId);
      if (upErr) throw new Error(upErr.message);
    } else {
      const { data: insSch, error: schErr } = await supabase
        .from("report_schedules")
        .insert({
          organization_id: organizationId,
          source_type: "pack",
          source_id: packId,
          timezone,
          recurrence_rule,
          output_format: "csv",
          title_pattern: "",
          status: "active",
          next_run_at,
          created_by: userUid,
          updated_by: userUid,
        })
        .select("id")
        .single();
      if (schErr || !insSch) throw new Error(schErr?.message ?? "Schedule insert failed");
      scheduleId = insSch.id as string;
    }

    if (!scheduleId) return;

    await supabase.from("report_schedule_recipients").update({ deleted_at: nowIso }).eq("schedule_id", scheduleId);

    const { error: recErr } = await supabase.from("report_schedule_recipients").insert({
      organization_id: organizationId,
      schedule_id: scheduleId,
      recipient_user_id: failureRecipientUserId || userUid,
      destination: "in_app",
    });
    if (recErr) throw new Error(recErr.message);
  }

  async function persistPack(opts: {
    existingPackId?: string | null;
    packName: string;
    description: string | null;
    orderedSlugs: string[];
    meta: PackUiMeta;
  }): Promise<string> {
    if (!orgId || !userId) throw new Error("Not signed in.");
    const { existingPackId, packName, description, orderedSlugs, meta } = opts;

    const rows = await fetchActiveTemplatesBySlug(supabase, orgId, orderedSlugs);
    const orderedIds = orderTemplateIdsBySlugOrder(rows, orderedSlugs);
    if (orderedIds.length === 0) throw new Error("Select at least one template that exists for your organization.");

    const notes = mergePackNotes(null, meta);

    let packId = existingPackId ?? null;

    if (!packId) {
      const { data: inserted, error: insErr } = await supabase
        .from("report_packs")
        .insert({
          organization_id: orgId,
          name: packName.trim(),
          description,
          category: packDbCategory(meta.pack_kind),
          owner_scope: "organization",
          official_pack: false,
          locked_definition: false,
          active: true,
          notes,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "Could not create pack.");
      packId = inserted.id as string;
    } else {
      const prev = packs.find((p) => p.id === packId)?.notes ?? null;
      const mergedNotes = mergePackNotes(prev, meta);
      const { error: upErr } = await supabase
        .from("report_packs")
        .update({
          name: packName.trim(),
          description,
          category: packDbCategory(meta.pack_kind),
          notes: mergedNotes,
          updated_by: userId,
        })
        .eq("id", packId)
        .eq("organization_id", orgId);
      if (upErr) throw new Error(upErr.message);
    }

    await replacePackItems(packId!, orgId, orderedIds);

    await syncPackSchedule({
      organizationId: orgId,
      userUid: userId,
      packId: packId!,
      packKind: meta.pack_kind,
      frequency: meta.frequency ?? "weekly",
      weekday: meta.weekday ?? 1,
      timeLocal: meta.time_local ?? "08:00",
      timezone: meta.timezone ?? TZ_DEFAULT,
      failureRecipientUserId: meta.failure_alert_user_id ?? userId,
    });

    return packId!;
  }

  async function onSaveCustomPack() {
    if (!canManage || !orgId || !userId) return;
    if (!name.trim()) {
      setError("Pack name is required.");
      return;
    }
    if (selectedOrderedSlugs.length === 0) {
      setError("Select at least one template.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await persistPack({
        existingPackId: editingPackId,
        packName: name.trim(),
        description:
          editingPackId ? (packs.find((p) => p.id === editingPackId)?.description ?? null) : null,
        orderedSlugs: selectedOrderedSlugs,
        meta: previewMeta,
      });
      resetCustomForm();
      setCustomOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save pack.");
    } finally {
      setBusy(false);
    }
  }

  async function enableStarter(starterId: string) {
    if (!canManage || !orgId || !userId) return;
    const starter = recommended.find((s) => s.id === starterId);
    if (!starter) return;

    setBusy(true);
    setError(null);
    try {
      const marker = starterMarker(starter.id);
      const { data: existing } = await supabase
        .from("report_packs")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("description", `${marker}%`)
        .is("deleted_at", null)
        .maybeSingle();

      if (existing?.id) {
        setError(`"${starter.name}" is already enabled.`);
        setBusy(false);
        return;
      }

      const meta: PackUiMeta = {
        pack_kind: "operational",
        frequency: starter.frequency,
        weekday: 1,
        time_local: "08:00",
        timezone: TZ_DEFAULT,
        event_trigger: null,
        delivery_destination: "in_app",
        failure_alert_user_id: userId,
      };

      await persistPack({
        existingPackId: null,
        packName: starter.name,
        description: `${marker}${starter.description}`,
        orderedSlugs: starter.templateSlugs,
        meta,
      });

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable starter pack.");
    } finally {
      setBusy(false);
    }
  }

  async function ensureSurveyVisitPackId(): Promise<string> {
    if (!orgId || !userId) throw new Error("Not signed in.");
    const marker = "[survey_visit_pack]";
    const { data: existing } = await supabase
      .from("report_packs")
      .select("id")
      .eq("organization_id", orgId)
      .ilike("description", `${marker}%`)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing?.id) {
      const pid = existing.id as string;
      const slugs = surveyVisitTemplateSlugs(PHASE1_TEMPLATE_SEED);
      const rows = await fetchActiveTemplatesBySlug(supabase, orgId, slugs);
      const orderedIds = orderTemplateIdsBySlugOrder(rows, slugs);
      await replacePackItems(pid, orgId, orderedIds);
      return pid;
    }

    const slugs = surveyVisitTemplateSlugs(PHASE1_TEMPLATE_SEED);
    const meta: PackUiMeta = {
      pack_kind: "event_based",
      event_trigger: "surveyor_arrival",
      delivery_destination: "in_app",
      failure_alert_user_id: userId,
    };

    return persistPack({
      existingPackId: null,
      packName: SURVEY_VISIT_PACK_NAME,
      description: `${marker} Pre-built survey readiness bundle.`,
      orderedSlugs: slugs,
      meta,
    });
  }

  async function onConfirmSurveyVisit() {
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSurveyVisitPackId();
      setSurveyDialogOpen(false);
      router.push(`/admin/reports/run/pack/${id}?autoRun=1`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Survey visit pack failed.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePackPaused(pack: PackRow) {
    if (!canManage || !orgId || !userId) return;
    const nextActive = !pack.active;
    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("report_packs")
        .update({ active: nextActive, updated_by: userId })
        .eq("id", pack.id)
        .eq("organization_id", orgId);
      if (upErr) throw new Error(upErr.message);

      const sch = schedulesByPackId.get(pack.id);
      if (sch) {
        const nextStatus = nextActive ? "active" : "paused";
        const { error: schErr } = await supabase
          .from("report_schedules")
          .update({ status: nextStatus, updated_by: userId })
          .eq("id", sch.id);
        if (schErr) throw new Error(schErr.message);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update pack.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !orgId || !userId) return;
    const packId = deleteTarget.id;
    const nowIso = new Date().toISOString();
    setBusy(true);
    setError(null);
    try {
      const sch = schedulesByPackId.get(packId);
      if (sch) {
        await supabase.from("report_schedule_recipients").update({ deleted_at: nowIso }).eq("schedule_id", sch.id);
        await supabase.from("report_schedules").update({ deleted_at: nowIso }).eq("id", sch.id);
      }

      await supabase.from("report_pack_items").update({ deleted_at: nowIso }).eq("pack_id", packId).eq("organization_id", orgId);

      const { error: delErr } = await supabase
        .from("report_packs")
        .update({ deleted_at: nowIso, active: false, updated_by: userId })
        .eq("id", packId)
        .eq("organization_id", orgId);
      if (delErr) throw new Error(delErr.message);

      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete pack.");
    } finally {
      setBusy(false);
    }
  }

  async function beginEdit(pack: PackRow) {
    if (!orgId) return;
    setEditingPackId(pack.id);
    setCustomOpen(true);
    setName(pack.name);
    const env = parsePackNotes(pack.notes);
    const ui = env.ui;
    const inferredKind: PackUiKind =
      ui?.pack_kind ??
      (pack.category === "role_based"
        ? "role_based"
        : pack.category === "event_based" || pack.category === "survey"
          ? "event_based"
          : "operational");
    setPackKind(inferredKind);
    if (ui?.frequency) setFrequency(ui.frequency);
    if (typeof ui?.weekday === "number") setWeekday(String(ui.weekday));
    if (ui?.time_local) setTimeLocal(ui.time_local);
    if (ui?.event_trigger) setEventTrigger(ui.event_trigger);
    setFailureAlertUserId(ui?.failure_alert_user_id ?? userId ?? "");

    const { data: items } = await supabase
      .from("report_pack_items")
      .select("source_id")
      .eq("pack_id", pack.id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("display_order", { ascending: true });

    const ids = (items ?? []).map((r) => (r as { source_id: string }).source_id);
    const next = new Set<string>();
    for (const tid of ids) {
      const slug = slugByTemplateId.get(tid);
      if (slug) next.add(slug);
    }
    setSelectedSlugs(next);
  }

  const sortedPacks = useMemo(() => {
    const enriched = packs.map((p) => {
      const meta = parsePackNotes(p.notes).ui;
      const sch = schedulesByPackId.get(p.id);
      return {
        pack: p,
        meta,
        sch,
        cadenceLabel: formatReportPackCadenceSummary(meta, sch),
        count: countsByPackId.get(p.id) ?? 0,
      };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    enriched.sort((a, b) => {
      if (sortKey === "name") return a.pack.name.localeCompare(b.pack.name) * dir;
      if (sortKey === "cadence") return a.cadenceLabel.localeCompare(b.cadenceLabel) * dir;
      const cmp = Number(a.pack.active) - Number(b.pack.active);
      return cmp * dir;
    });
    return enriched;
  }, [countsByPackId, packs, schedulesByPackId, sortDir, sortKey]);

  function toggleSort(key: typeof sortKey) {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <div className="relative z-10 mx-auto max-w-7xl space-y-6 px-4 sm:px-6 xl:px-0">
        <div className="mt-4">
          <ReportsHubNav />
        </div>

        <header className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Report packs</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Packs bundle multiple reports into one deliverable. For single reports on a schedule, use{" "}
              <Link href="/admin/reports/scheduled" className="font-medium text-primary underline-offset-4 hover:underline">
                Scheduled
              </Link>
              . For ad-hoc one-off runs, use{" "}
              <Link href="/admin/reports/templates" className="font-medium text-primary underline-offset-4 hover:underline">
                Templates
              </Link>
              .
            </p>
          </div>
          <div className="shrink-0 md:pt-1">
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-amber-500/40 bg-amber-500/5 text-foreground hover:bg-amber-500/10"
              disabled={!canManage || busy}
              onClick={() => setSurveyDialogOpen(true)}
            >
              <Zap className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
              Run survey visit pack
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Recommended packs</h2>
          <p className="text-sm text-muted-foreground">
            Enable an opinionated starter bundle—templates and cadence are pre-filled.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {recommended.map((starter) => (
              <div key={starter.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <p className="font-medium text-foreground">{starter.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{starter.description}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {starter.templateSlugs.length} reports · {starter.cadenceLabel}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-4"
                  disabled={!canManage || busy}
                  onClick={() => void enableStarter(starter.id)}
                >
                  Enable
                </Button>
              </div>
            ))}
          </div>
        </section>

        {canManage ? (
          <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
            <CollapsibleTrigger
              type="button"
              className={cn(
                buttonVariants({ variant: "ghost", size: "default" }),
                "gap-2 px-0 text-foreground hover:bg-transparent aria-expanded:bg-transparent",
              )}
            >
              <ChevronDown className={cn("size-4 transition-transform", customOpen && "rotate-180")} aria-hidden />
              {editingPackId ? "Edit custom pack" : "Create custom pack"}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-2">
              <div className="rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm space-y-6">
                <p className="text-sm text-muted-foreground">
                  Start from scratch when recommended bundles don&apos;t fit. Choose templates first—every pack needs at least one report.
                </p>

                <div className="grid gap-2 max-w-lg">
                  <Label htmlFor="pack-name">Pack name</Label>
                  <Input
                    id="pack-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. CFO weekly snapshot"
                    className="max-w-lg"
                  />
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-foreground">Pack type</legend>
                  <div className="grid gap-3 md:grid-cols-3">
                    {PACK_KIND_COPY.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={packKind === k.id}
                        onClick={() => setPackKind(k.id)}
                        className={cn(
                          "rounded-lg border p-4 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          packKind === k.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                        )}
                      >
                        <span className="font-medium text-foreground">{k.title}</span>
                        <span className="mt-2 block text-muted-foreground">{k.description}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-foreground">Templates</legend>
                  <p className="text-xs text-muted-foreground">
                    Select one or more Phase 1 templates (grouped by category).
                  </p>
                  <div className="space-y-4 max-h-[320px] overflow-y-auto rounded-md border border-border p-3">
                    {templatesByCategory.map(([category, items]) => (
                      <div key={category}>
                        <p className="text-xs font-semibold text-muted-foreground">{category}</p>
                        <ul className="mt-2 space-y-2">
                          {items.map((t) => (
                            <li key={t.slug}>
                              <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={selectedSlugs.has(t.slug)}
                                  onChange={() => toggleSlug(t.slug)}
                                  className="mt-1 size-4 rounded border-input"
                                />
                                <span>
                                  <span className="font-medium text-foreground">{t.name}</span>
                                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </fieldset>

                {singleTemplateWarn ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                    Consider using{" "}
                    <Link href="/admin/reports/scheduled" className="underline underline-offset-2">
                      Scheduled
                    </Link>{" "}
                    instead when you only need a single report on a cadence.
                  </p>
                ) : null}

                {packKind !== "event_based" ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="pack-frequency">Frequency</Label>
                      <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleFrequency)}>
                        <SelectTrigger id="pack-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {frequency === "weekly" ? (
                      <div className="grid gap-2">
                        <Label htmlFor="pack-weekday">Day</Label>
                        <Select value={weekday} onValueChange={setWeekday}>
                          <SelectTrigger id="pack-weekday">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEEKDAY_OPTIONS.map((d) => (
                              <SelectItem key={d.value} value={d.value}>
                                {d.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="hidden md:block" aria-hidden />
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="pack-time">Time ({TZ_DEFAULT})</Label>
                      <Input id="pack-time" type="time" value={timeLocal} onChange={(e) => setTimeLocal(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2 max-w-md">
                    <Label htmlFor="pack-trigger">Trigger</Label>
                    <Select value={eventTrigger} onValueChange={(v) => setEventTrigger(v as EventTrigger)}>
                      <SelectTrigger id="pack-trigger">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TRIGGER_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="pack-delivery">Delivery destination</Label>
                    <Select value={deliveryDestination} disabled>
                      <SelectTrigger id="pack-delivery">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_app">In-app notification (current)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Email and Slack delivery — coming soon.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pack-alert-user">Alert on failure</Label>
                    <Select value={failureAlertUserId} onValueChange={setFailureAlertUserId}>
                      <SelectTrigger id="pack-alert-user">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.full_name || u.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm font-medium text-foreground">Preview</p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <li>{selectedOrderedSlugs.length} reports in pack</li>
                    <li>
                      Estimated output · ~{estimatePdfPages(selectedOrderedSlugs.length)} pages PDF (approximate)
                    </li>
                    <li>
                      Next run ·{" "}
                      {previewNextRunIso ? (
                        <span className="text-foreground">{format(new Date(previewNextRunIso), "PPpp")}</span>
                      ) : (
                        <span className="text-foreground">Manual / event-triggered</span>
                      )}
                    </li>
                    <li>Delivery · In-app notification</li>
                  </ul>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={busy} onClick={() => void onSaveCustomPack()}>
                    {busy ? "Saving…" : editingPackId ? "Save changes" : "Create pack"}
                  </Button>
                  {editingPackId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        resetCustomForm();
                        setCustomOpen(false);
                      }}
                    >
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Pack registry</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading packs…</p>
          ) : packs.length === 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>No custom packs yet. Enable a recommended pack above or create one.</p>
              <p>
                Go to{" "}
                <Link href="/admin/reports/templates" className="font-medium text-primary underline-offset-4 hover:underline">
                  Templates
                </Link>{" "}
                or{" "}
                <Link href="/admin/reports/scheduled" className="font-medium text-primary underline-offset-4 hover:underline">
                  Scheduled
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">
                      <button type="button" className="font-medium hover:underline" onClick={() => toggleSort("name")}>
                        Pack name
                      </button>
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>
                      <button type="button" className="font-medium hover:underline" onClick={() => toggleSort("cadence")}>
                        Cadence
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Templates</TableHead>
                    <TableHead>
                      <button type="button" className="font-medium hover:underline" onClick={() => toggleSort("status")}>
                        Status
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPacks.map(({ pack, cadenceLabel, count }) => (
                    <TableRow key={pack.id}>
                      <TableCell className="font-medium text-foreground">{pack.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal capitalize">
                          {labelPackType(pack.category)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{cadenceLabel}</TableCell>
                      <TableCell className="text-right tabular-nums">{count}</TableCell>
                      <TableCell>
                        <Badge variant={pack.active ? "default" : "outline"} className="font-normal">
                          {pack.active ? "Active" : "Paused"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            href={`/admin/reports/run/pack/${pack.id}`}
                            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                          >
                            Run now
                          </Link>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy || !canManage || surveyVisitMarker(pack.description)}
                            onClick={() => void togglePackPaused(pack)}
                          >
                            {pack.active ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy || !canManage || surveyVisitMarker(pack.description)}
                            onClick={() => void beginEdit(pack)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={busy || !canManage || surveyVisitMarker(pack.description)}
                            onClick={() => setDeleteTarget(pack)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <Dialog open={surveyDialogOpen} onOpenChange={setSurveyDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generate survey visit pack now?</DialogTitle>
              <DialogDescription>
                This bundles every Phase 1 compliance-ready template—typically around ninety seconds once scope is selected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setSurveyDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void onConfirmSurveyVisit()}>
                Generate now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete pack?</DialogTitle>
              <DialogDescription>
                This removes &quot;{deleteTarget?.name}&quot;, its templates link, and scheduled dispatches for your organization.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
                Delete pack
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
