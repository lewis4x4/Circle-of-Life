"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";

import { AdminEmptyState, AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { EntityCombobox, type EntityComboboxOption } from "@/components/ui/entity-combobox";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  formatObservationPlanAcuityDisplay,
  formatObservationPlanAcuitySegment,
} from "@/lib/rounding/observation-plan-display-copy";
import {
  buildPlanSchedulePreview,
  formatPreviewTimestamp,
  formatTimeLabel,
  getObservationPlanSaveBlockers,
  hasRuleErrors,
  MIN_RATIONALE_CHARACTERS,
  validateEffectiveWindow,
  validatePlanRule,
  validateRationale,
} from "@/lib/rounding/observation-plan-validation";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  getColDiscoveryCadenceProfile,
  resolveColDiscoveryCadenceKey,
  resolveColDiscoveryDefaultRules,
  type ColDiscoveryCadenceProfile,
} from "@/lib/rounding/col-discovery-round-cadence";
import type { ObservationPlanTemplateOption } from "@/lib/rounding/observation-plan-templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ObservationPlanInput, PlanRuleInput } from "@/lib/rounding/types";
import type { Database } from "@/types/database";

type PlanStatus = NonNullable<ObservationPlanInput["status"]>;
type SourceType = NonNullable<ObservationPlanInput["sourceType"]>;

type ResidentOption = Pick<
  Database["public"]["Tables"]["residents"]["Row"],
  | "id"
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "status"
  | "bed_id"
  | "acuity_level"
  | "acuity_score"
> & {
  beds?: {
    bed_label: string | null;
    rooms?: { room_number: string | null } | null;
  } | null;
};

type ExistingPlan = {
  id: string;
  resident_id: string;
  status: ObservationPlanInput["status"];
  source_type: ObservationPlanInput["sourceType"];
  effective_from: string;
  effective_to: string | null;
  rationale: string | null;
  resident_observation_plan_rules?: Array<{
    id: string;
    interval_type: PlanRuleInput["intervalType"];
    interval_minutes: number | null;
    shift: PlanRuleInput["shift"];
    daypart_start: string | null;
    daypart_end: string | null;
    days_of_week: number[] | null;
    grace_minutes: number;
    required_fields_schema: Record<string, unknown> | null;
    escalation_policy_key: string | null;
    active: boolean;
    sort_order: number;
  }>;
};

const STATUS_OPTIONS: Array<{ value: PlanStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Suspended" },
  { value: "ended", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
];

const SOURCE_TYPE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "care_plan", label: "Template / care plan" },
  { value: "order", label: "EHR / clinical order" },
  { value: "policy", label: "Policy" },
  { value: "triggered", label: "Triggered" },
];

const INTERVAL_TYPE_OPTIONS: Array<{ value: PlanRuleInput["intervalType"]; label: string }> = [
  { value: "fixed_minutes", label: "Fixed minutes" },
  { value: "per_shift", label: "Per shift" },
  { value: "daypart", label: "Daypart" },
  { value: "continuous", label: "Continuous" },
];

const SHIFT_OPTIONS: Array<{ value: "all" | NonNullable<PlanRuleInput["shift"]>; label: string }> = [
  { value: "all", label: "All shifts" },
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "custom", label: "Custom" },
];

const RESIDENT_SELECT_WITH_BED =
  "id, first_name, last_name, preferred_name, status, bed_id, acuity_level, acuity_score, beds!residents_bed_id_fkey ( bed_label, rooms ( room_number ) )";

const RESIDENT_SELECT_FALLBACK =
  "id, first_name, last_name, preferred_name, status, bed_id, acuity_level, acuity_score";

function blankRule(sortOrder = 0): PlanRuleInput {
  return {
    intervalType: "fixed_minutes",
    intervalMinutes: 60,
    daypartStart: "07:00",
    daypartEnd: "19:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: 15,
    active: true,
    sortOrder,
  };
}

function defaultRulesForNewPlan(facilityName: string): {
  rules: PlanRuleInput[];
  cadenceProfile: ColDiscoveryCadenceProfile | null;
  templateName: string | null;
} {
  const discovery = resolveColDiscoveryDefaultRules(facilityName);
  if (discovery.rules.length > 0) {
    return {
      rules: discovery.rules,
      cadenceProfile: discovery.profile,
      templateName: discovery.templateName,
    };
  }

  if (discovery.profile === "pending") {
    return {
      rules: [],
      cadenceProfile: discovery.profile,
      templateName: discovery.templateName,
    };
  }

  return {
    rules: [blankRule()],
    cadenceProfile: discovery.profile,
    templateName: discovery.templateName,
  };
}

function residentName(resident: Pick<ResidentOption, "first_name" | "last_name" | "preferred_name">) {
  return [resident.preferred_name ?? resident.first_name, resident.last_name].filter(Boolean).join(" ");
}

function residentRoom(resident: ResidentOption) {
  return resident.beds?.rooms?.room_number ?? resident.beds?.bed_label ?? "Unassigned";
}

function residentComboboxLabel(resident: ResidentOption) {
  const name = residentName(resident) || "Unnamed resident";
  const acuitySegment = formatObservationPlanAcuitySegment(resident.acuity_score, resident.acuity_level);
  return `${name} · Room ${residentRoom(resident)} · ${acuitySegment}`;
}

export function ObservationPlanEditor({
  planId,
  duplicatePlanId,
  title,
}: {
  planId?: string;
  duplicatePlanId?: string;
  title: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find((facility) => facility.id === selectedFacilityId);
  const facilityName = selectedFacility?.name ?? "selected facility";
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [draggedRuleIndex, setDraggedRuleIndex] = useState<number | null>(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [touchedRuleFields, setTouchedRuleFields] = useState<Record<string, true>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [cadenceProfile, setCadenceProfile] = useState<ColDiscoveryCadenceProfile | null>(null);
  const [cadenceTemplateName, setCadenceTemplateName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ObservationPlanTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [applyingDefault, setApplyingDefault] = useState(false);
  const [residentId, setResidentId] = useState("");
  const [status, setStatus] = useState<PlanStatus>("draft");
  const [sourceType, setSourceType] = useState<SourceType>("manual");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [rationale, setRationale] = useState("");
  const [rules, setRules] = useState<PlanRuleInput[]>([]);

  const cadenceKey = resolveColDiscoveryCadenceKey(facilityName);
  const isPlantationPending = cadenceKey != null && getColDiscoveryCadenceProfile(cadenceKey) === "pending";
  const isNewPlan = !planId && !duplicatePlanId;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

  const applyTemplateRules = useCallback((template: ObservationPlanTemplateOption | null) => {
    if (!template) return;
    setRules(template.rules.map((rule, index) => ({ ...rule, sortOrder: index })));
    setCadenceProfile((template.cadenceProfile as ColDiscoveryCadenceProfile | null) ?? null);
    setCadenceTemplateName(template.name);
    setSourceType("care_plan");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setStatusMessage(null);
    setSaveAttempted(false);

    if (!selectedFacilityId) {
      setLoading(false);
      return;
    }

    try {
      let residentRows: ResidentOption[] = [];

      const primaryRes = await supabase
        .from("residents")
        .select(RESIDENT_SELECT_WITH_BED)
        .eq("facility_id", selectedFacilityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("last_name");

      if (primaryRes.error) {
        const fallbackRes = await supabase
          .from("residents")
          .select(RESIDENT_SELECT_FALLBACK)
          .eq("facility_id", selectedFacilityId)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("last_name");

        if (fallbackRes.error) throw fallbackRes.error;

        residentRows = (fallbackRes.data ?? []).map((row) => ({
          ...(row as ResidentOption),
          beds: null,
        }));
      } else {
        residentRows = (primaryRes.data ?? []) as unknown as ResidentOption[];
      }

      setResidents(residentRows);

      const sourcePlanId = planId ?? duplicatePlanId;
      if (sourcePlanId) {
        setCadenceProfile(null);
        setCadenceTemplateName(null);
        const response = await fetch(
          `/api/rounding/plans?planId=${encodeURIComponent(sourcePlanId)}&facilityId=${encodeURIComponent(selectedFacilityId)}`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as { error?: string; plans?: ExistingPlan[] };
        if (!response.ok) {
          throw new Error(json.error ?? "Could not load observation plan");
        }
        const plan = json.plans?.[0];
        if (!plan) {
          throw new Error("Observation plan not found");
        }
        setResidentId(plan.resident_id);
        setStatus(duplicatePlanId ? "draft" : (plan.status ?? "draft"));
        setSourceType(plan.source_type ?? "manual");
        setEffectiveFrom(duplicatePlanId ? "" : plan.effective_from.slice(0, 16));
        setEffectiveTo(duplicatePlanId ? "" : plan.effective_to ? plan.effective_to.slice(0, 16) : "");
        setRationale(plan.rationale ?? "");
        setRules(
          (plan.resident_observation_plan_rules ?? [])
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((rule, index) => ({
              id: duplicatePlanId ? undefined : rule.id,
              intervalType: rule.interval_type,
              intervalMinutes: rule.interval_minutes,
              shift: rule.shift,
              daypartStart: rule.daypart_start,
              daypartEnd: rule.daypart_end,
              daysOfWeek: rule.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
              graceMinutes: rule.grace_minutes,
              requiredFieldsSchema: rule.required_fields_schema ?? {},
              escalationPolicyKey: rule.escalation_policy_key,
              active: rule.active,
              sortOrder: index,
            })),
        );
      } else {
        const templateResponse = await fetch(
          `/api/rounding/plans/templates?facilityId=${encodeURIComponent(selectedFacilityId)}`,
          { cache: "no-store" },
        );
        const templateJson = (await templateResponse.json()) as {
          templates?: ObservationPlanTemplateOption[];
        };
        const loadedTemplates = templateResponse.ok ? (templateJson.templates ?? []) : [];
        setTemplates(loadedTemplates);

        const defaults = defaultRulesForNewPlan(facilityName);
        const initialTemplate =
          loadedTemplates.find((template) => template.name === defaults.templateName) ??
          loadedTemplates[0] ??
          null;

        if (initialTemplate) {
          setSelectedTemplateId(initialTemplate.id);
          setCadenceProfile((initialTemplate.cadenceProfile as ColDiscoveryCadenceProfile | null) ?? defaults.cadenceProfile);
          setCadenceTemplateName(initialTemplate.name);
          setRules(initialTemplate.rules.map((rule, index) => ({ ...rule, sortOrder: index })));
        } else {
          setSelectedTemplateId("");
          setCadenceProfile(defaults.cadenceProfile);
          setCadenceTemplateName(defaults.templateName);
          setRules(defaults.rules);
        }

        setResidentId("");
        setStatus("draft");
        setSourceType(initialTemplate ? "care_plan" : "manual");
        setEffectiveFrom("");
        setEffectiveTo("");
        setRationale("");
      }
    } catch (err) {
      setLoadError(
        formatLiveDataLoadError(err, "Could not load observation plan form. Confirm facility scope and retry."),
      );
    } finally {
      setLoading(false);
    }
  }, [duplicatePlanId, facilityName, planId, selectedFacilityId, supabase]);

  async function applyDiscoveryDefaultForResident() {
    if (!selectedFacilityId || !residentId) {
      setSaveError("Select a resident before applying the discovery default.");
      return;
    }

    if (isPlantationPending) {
      setSaveError("Plantation discovery cadence is pending owner decision.");
      return;
    }

    setApplyingDefault(true);
    setSaveError(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/rounding/plans/apply-discovery-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, facilityId: selectedFacilityId }),
      });
      const json = (await response.json()) as { error?: string; planId?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not apply discovery-round default");
      }

      setStatusMessage("Discovery-round default applied for this resident.");
      router.replace(`/admin/rounding/plans/${json.planId ?? ""}`);
    } catch (err) {
      setSaveError(formatLiveDataLoadError(err, "Could not apply discovery-round default. Confirm resident scope and retry."));
    } finally {
      setApplyingDefault(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  const residentOptions = useMemo<EntityComboboxOption[]>(
    () =>
      residents.map((resident) => {
        const label = residentComboboxLabel(resident);
        return {
          id: resident.id,
          label,
          keywords: `${label} ${residentName(resident)} ${residentRoom(resident)} ${formatObservationPlanAcuityDisplay(resident.acuity_score, resident.acuity_level)}`,
        };
      }),
    [residents],
  );

  const selectedResident = residents.find((resident) => resident.id === residentId) ?? null;
  const effectiveWindowError = validateEffectiveWindow(effectiveFrom, effectiveTo);
  const rationaleError = validateRationale(rationale);
  const ruleErrors = useMemo(() => rules.map((rule) => validatePlanRule(rule)), [rules]);
  const preview = useMemo(() => buildPlanSchedulePreview(rules), [rules]);
  const saveBlockers = useMemo(
    () =>
      getObservationPlanSaveBlockers({
        residentId,
        status,
        sourceType,
        effectiveFrom,
        effectiveTo,
        rationale,
        rules,
      }),
    [effectiveFrom, effectiveTo, rationale, residentId, rules, sourceType, status],
  );
  const canSave = saveBlockers.length === 0;
  const saveTooltip = saveBlockers.join(" · ");
  const hasActiveResidents = residents.length > 0;
  const showEmptyResidentsNotice = !loadError && !loading && !hasActiveResidents;

  async function savePlan() {
    setSaveAttempted(true);
    if (!selectedFacilityId) {
      setSaveError("Select a facility first.");
      return;
    }
    if (!canSave) {
      setSaveError(`Complete required fields: ${saveTooltip}.`);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setStatusMessage(null);
    try {
      const payload: ObservationPlanInput = {
        id: planId,
        facilityId: selectedFacilityId,
        residentId,
        status,
        sourceType,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
        rationale: rationale.trim(),
        rules: rules.map((rule, index) => ({
          ...rule,
          sortOrder: index,
          daysOfWeek: rule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
        })),
      };

      const response = await fetch("/api/rounding/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string; planId?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not save observation plan");
      }

      setStatusMessage("Observation plan saved.");
      router.replace(`/admin/rounding/plans/${json.planId ?? planId ?? ""}`);
    } catch (err) {
      setSaveError(
        formatLiveDataLoadError(err, "Could not save observation plan. Confirm required fields and retry."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!selectedFacilityId) {
    return (
      <Card className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/30">
        <CardContent className="py-6 text-sm text-amber-950 dark:text-amber-100">
          Select a facility in the header before creating or editing a rounding plan.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading plan editor…
      </div>
    );
  }

  return (
    <TooltipProvider delay={250}>
      <div className="space-y-6">
        {loadError ? <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} /> : null}
        {showEmptyResidentsNotice ? (
          <AdminEmptyState
            title="No active residents at this facility"
            description={`The census at ${facilityName} is empty right now. You can still draft cadence rules, but choose a resident once someone is admitted before saving a plan.`}
          />
        ) : null}
        {!loadError && isNewPlan ? (
          <CadenceDefaultsPanel
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            cadenceProfile={cadenceProfile}
            cadenceTemplateName={cadenceTemplateName}
            facilityName={facilityName}
            isPlantationPending={isPlantationPending}
            residentSelected={Boolean(residentId)}
            applyingDefault={applyingDefault}
            onTemplateChange={(templateId) => {
              setSelectedTemplateId(templateId);
              const template = templates.find((entry) => entry.id === templateId) ?? null;
              applyTemplateRules(template);
            }}
            onResetFromTemplate={() => applyTemplateRules(selectedTemplate)}
            onApplyForResident={() => void applyDiscoveryDefaultForResident()}
          />
        ) : null}

        <Card className="border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              Set resident cadence, daypart windows, and grace times for facility-scoped rounding tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            {statusMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{statusMessage}</p> : null}

            <FormSection title="Identity">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-1">
                  <EntityCombobox
                    id="resident"
                    label="Resident"
                    placeholder="Select resident"
                    searchPlaceholder="Search active residents…"
                    options={residentOptions}
                    value={residentId}
                    onChange={setResidentId}
                    required
                    data-testid="observation-plan-resident"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {hasActiveResidents
                      ? `${residents.length} active residents at ${facilityName} available.`
                      : `No active residents at ${facilityName} right now.`}
                  </p>
                </div>

                <FormField id="status" label="Status" required>
                  <Select value={status} onValueChange={(value) => setStatus(value as PlanStatus)} required>
                    <SelectTrigger id="status" className="h-9">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  id="source-type"
                  label="Source type"
                  required
                  helper="Manual: created by hand. Template: derived from a care plan template. EHR: imported from external system."
                >
                  <Select value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)} required>
                    <SelectTrigger id="source-type" className="h-9">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Effective window">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField id="effective-from" label="Effective from" required>
                  <DateTimePicker
                    id="effective-from"
                    value={effectiveFrom}
                    onValueChange={setEffectiveFrom}
                    required
                  />
                </FormField>

                <FormField
                  id="effective-to"
                  label="Effective to"
                  helper="Leave empty for open-ended plan."
                  error={effectiveWindowError ?? undefined}
                >
                  <DateTimePicker
                    id="effective-to"
                    value={effectiveTo}
                    onValueChange={setEffectiveTo}
                    placeholder="Open-ended"
                    aria-invalid={Boolean(effectiveWindowError)}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Rationale">
              <FormField
                id="rationale"
                label="Rationale"
                required
                helper={`Required for audit trail. Surveyors review rationale on cadence changes. Minimum ${MIN_RATIONALE_CHARACTERS} characters.`}
                error={(saveAttempted || rationale.trim().length > 0) && rationaleError ? rationaleError : undefined}
              >
                <Textarea
                  id="rationale"
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  rows={4}
                  required
                  aria-invalid={Boolean((saveAttempted || rationale.trim().length > 0) && rationaleError)}
                  placeholder="Explain the clinical reason for this cadence change."
                />
              </FormField>
            </FormSection>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Rules</h2>
              <p className="text-sm text-muted-foreground">Configure interval, daypart, and grace.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRules((current) => [...current, blankRule(current.length)])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add rule
            </Button>
          </div>

          {rules.length === 0 ? (
            <AdminEmptyState
              title="No cadence rules yet"
              description={
                cadenceProfile === "pending"
                  ? `Plantation discovery cadence is pending owner decision. Add rules manually once Jessica supplies times — Haven will not pre-fill wing or 12-hour schedules.`
                  : "Add at least one rule to define when checks should occur."
              }
            />
          ) : null}

          {rules.map((rule, index) => {
            const currentRuleErrors = ruleErrors[index] ?? {};
            const ruleHasErrors = hasRuleErrors(currentRuleErrors);
            const ruleKey = rule.id ?? `rule-${index}`;
            const showIntervalError = Boolean(
              currentRuleErrors.intervalMinutes && (saveAttempted || touchedRuleFields[`${ruleKey}:intervalMinutes`]),
            );
            const showGraceError = Boolean(
              currentRuleErrors.graceMinutes && (saveAttempted || touchedRuleFields[`${ruleKey}:graceMinutes`]),
            );

            return (
              <Card
                key={ruleKey}
                className={cn(
                  "border-border bg-card shadow-soft",
                  draggedRuleIndex === index && "opacity-70",
                  ruleHasErrors && saveAttempted && "border-destructive/50",
                )}
                onDragOver={(event) => {
                  if (rules.length > 1) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedRuleIndex != null) reorderRule(draggedRuleIndex, index);
                  setDraggedRuleIndex(null);
                }}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    {rules.length > 1 ? (
                      <button
                        type="button"
                        draggable
                        aria-label={`Drag Rule ${index + 1}`}
                        className="mt-0.5 rounded-md p-1 text-muted-foreground cursor-grab hover:bg-muted/40 hover:text-foreground active:cursor-grabbing"
                        onDragStart={() => setDraggedRuleIndex(index)}
                        onDragEnd={() => setDraggedRuleIndex(null)}
                      >
                        <GripVertical className="size-4" aria-hidden />
                      </button>
                    ) : null}
                    <div className="min-w-0">
                      {rules.length > 1 ? <CardTitle className="text-base">Rule {index + 1}</CardTitle> : null}
                      <CardDescription>Configure interval, daypart, and grace.</CardDescription>
                    </div>
                  </div>
                  {rules.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete Rule ${index + 1}`}
                      onClick={() => setPendingDeleteIndex(index)}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <FormField id={`interval-type-${index}`} label="Interval type">
                    <Select
                      value={rule.intervalType}
                      onValueChange={(value) => updateRule(index, { intervalType: value as PlanRuleInput["intervalType"] })}
                    >
                      <SelectTrigger id={`interval-type-${index}`} className="h-9">
                        <SelectValue placeholder="Select interval" />
                      </SelectTrigger>
                      <SelectContent>
                        {INTERVAL_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField
                    id={`interval-minutes-${index}`}
                    label="Interval minutes"
                    error={showIntervalError ? currentRuleErrors.intervalMinutes : undefined}
                  >
                    <Input
                      id={`interval-minutes-${index}`}
                      type="number"
                      min={5}
                      max={1440}
                      step={5}
                      value={rule.intervalMinutes ?? 60}
                      aria-invalid={showIntervalError}
                      onBlur={() => markRuleTouched(ruleKey, "intervalMinutes")}
                      onChange={(event) => updateRule(index, { intervalMinutes: Number(event.target.value) })}
                    />
                  </FormField>

                  <FormField id={`daypart-start-${index}`} label="Daypart start">
                    <Input
                      id={`daypart-start-${index}`}
                      type="time"
                      value={rule.daypartStart ?? "07:00"}
                      onChange={(event) => updateRule(index, { daypartStart: event.target.value })}
                    />
                  </FormField>

                  <FormField id={`daypart-end-${index}`} label="Daypart end">
                    <Input
                      id={`daypart-end-${index}`}
                      type="time"
                      value={rule.daypartEnd ?? "19:00"}
                      onChange={(event) => updateRule(index, { daypartEnd: event.target.value })}
                    />
                  </FormField>

                  <FormField
                    id={`grace-minutes-${index}`}
                    label="Grace minutes"
                    error={showGraceError ? currentRuleErrors.graceMinutes : undefined}
                  >
                    <Input
                      id={`grace-minutes-${index}`}
                      type="number"
                      min={0}
                      step={5}
                      value={rule.graceMinutes ?? 15}
                      aria-invalid={showGraceError}
                      onBlur={() => markRuleTouched(ruleKey, "graceMinutes")}
                      onChange={(event) => updateRule(index, { graceMinutes: Number(event.target.value) })}
                    />
                  </FormField>

                  <FormField
                    id={`shift-lock-${index}`}
                    label="Shift lock (optional)"
                    helper="Restrict this rule to a specific shift (Day, Evening, Night). Leave on All shifts to apply throughout the day."
                  >
                    <Select
                      value={rule.shift ?? "all"}
                      onValueChange={(value) =>
                        updateRule(index, {
                          shift: value === "all" ? null : (value as PlanRuleInput["shift"]),
                        })
                      }
                    >
                      <SelectTrigger id={`shift-lock-${index}`} className="h-9">
                        <SelectValue placeholder="All shifts" />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIFT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <PlanPreviewCard preview={preview} residentName={selectedResident ? residentName(selectedResident) : null} status={status} />

        <div className="flex flex-col-reverse items-stretch justify-end gap-3 sm:flex-row sm:items-center">
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => router.push("/admin/rounding/plans")}>
            Back to plans
          </Button>
          {canSave ? (
            <Button size="lg" className="min-h-11" disabled={saving} onClick={() => void savePlan()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save plan
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex" tabIndex={0} aria-label={`Save disabled: ${saveTooltip}`}>
                    <Button size="lg" className="min-h-11" disabled>
                      Save plan
                    </Button>
                  </span>
                }
              />
              <TooltipContent className="max-w-sm text-left" side="top" align="end">
                {saveTooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <Dialog open={pendingDeleteIndex != null} onOpenChange={(open) => !open && setPendingDeleteIndex(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Rule {(pendingDeleteIndex ?? 0) + 1}?</DialogTitle>
              <DialogDescription>This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingDeleteIndex(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDeleteRule}>
                Delete rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );

  function updateRule(index: number, updates: Partial<PlanRuleInput>) {
    setRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...updates, sortOrder: ruleIndex } : rule,
      ),
    );
  }

  function markRuleTouched(ruleKey: string, field: "intervalMinutes" | "graceMinutes") {
    setTouchedRuleFields((current) => ({ ...current, [`${ruleKey}:${field}`]: true }));
  }

  function reorderRule(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setRules((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return current;
      next.splice(toIndex, 0, moved);
      return next.map((rule, index) => ({ ...rule, sortOrder: index }));
    });
  }

  function confirmDeleteRule() {
    if (pendingDeleteIndex == null) return;
    setRules((current) => current.filter((_, currentIndex) => currentIndex !== pendingDeleteIndex));
    setPendingDeleteIndex(null);
  }
}

function CadenceDefaultsPanel({
  templates,
  selectedTemplateId,
  cadenceProfile,
  cadenceTemplateName,
  facilityName,
  isPlantationPending,
  residentSelected,
  applyingDefault,
  onTemplateChange,
  onResetFromTemplate,
  onApplyForResident,
}: {
  templates: ObservationPlanTemplateOption[];
  selectedTemplateId: string;
  cadenceProfile: ColDiscoveryCadenceProfile | null;
  cadenceTemplateName: string | null;
  facilityName: string;
  isPlantationPending: boolean;
  residentSelected: boolean;
  applyingDefault: boolean;
  onTemplateChange: (templateId: string) => void;
  onResetFromTemplate: () => void;
  onApplyForResident: () => void;
}) {
  if (isPlantationPending) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-4">
        <p className="text-[13px] font-semibold text-foreground">
          {cadenceTemplateName ?? "COL Discovery Rounds (cadence pending)"}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {facilityName} discovery cadence is pending owner decision. Haven will not apply wing-stagger or 12-hour
          defaults here — add rules after Jessica confirms times.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 px-4 py-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground">Facility cadence template</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          New plans start from Jessica discovery-round times for {facilityName}. Migration 219 12-hour and wing
          templates are not offered here.
        </p>
      </div>

      {templates.length > 0 ? (
        <FormField
          id="cadence-template"
          label="Template"
          helper="Choose the facility discovery template, then review rules before saving."
        >
          <Select value={selectedTemplateId} onValueChange={onTemplateChange}>
            <SelectTrigger id="cadence-template" className="h-9">
              <SelectValue placeholder="Select cadence template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {cadenceTemplateName
            ? `Using ${cadenceTemplateName} from Haven defaults.`
            : "No facility template is configured. Add rules manually."}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="outline" size="sm" disabled={!selectedTemplateId} onClick={onResetFromTemplate}>
          Reset rules from template
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!residentSelected || applyingDefault}
          onClick={onApplyForResident}
        >
          {applyingDefault ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Apply discovery default for resident
        </Button>
      </div>

      {cadenceProfile && cadenceProfile !== "pending" ? (
        <p className="text-[12px] text-muted-foreground">
          Preview below reflects discrete Jessica check times
          {cadenceProfile === "homewood_two_hour_night" ? " with two-hour overnight checks" : " for day and night"}.
        </p>
      ) : null}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FormField({
  id,
  label,
  required,
  helper,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <FormLabel htmlFor={id} required={required}>
        {label}
      </FormLabel>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="text-sm text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

function PlanPreviewCard({
  preview,
  residentName,
  status,
}: {
  preview: ReturnType<typeof buildPlanSchedulePreview>;
  residentName: string | null;
  status: PlanStatus;
}) {
  const residentClause = residentName ? ` for ${residentName}` : "";
  const nextChecks = preview.nextChecks.map(formatPreviewTimestamp).join(", ");

  return (
    <Card className="border-border bg-card shadow-soft">
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <CardDescription>Review the schedule impact before saving.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-foreground">
        <p>
          <span className="font-semibold">Preview:</span> This plan will create {preview.checksPerDay} scheduled checks per day
          {residentClause}, between {formatTimeLabel(preview.windowStart)} and {formatTimeLabel(preview.windowEnd)}. Each check becomes overdue {preview.graceMinutes} minutes after its scheduled time.
        </p>
        <p>
          <span className="font-semibold">Next 24 hours:</span> {nextChecks || "No scheduled checks in the next 24 hours."}
        </p>
        <ActivationNotice status={status} />
      </CardContent>
    </Card>
  );
}

function ActivationNotice({ status }: { status: PlanStatus }) {
  if (status === "active") {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        ⚠ This plan will activate immediately on save. Switch to Draft to review before activating.
      </p>
    );
  }

  if (status === "draft") {
    return (
      <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
        <CheckCircle2 className="size-4" aria-hidden />
        Saving as Draft. Activate from the Plans tab when ready.
      </p>
    );
  }

  if (status === "paused") {
    return (
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        ○ Saving as Suspended. This plan will not generate checks until reactivated.
      </p>
    );
  }

  return (
    <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      ○ This plan will not generate checks while saved as {STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status}.
    </p>
  );
}
