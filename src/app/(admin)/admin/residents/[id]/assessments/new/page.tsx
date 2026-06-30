"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { assessmentFormSchema, type AssessmentFormData } from "@/lib/validation/assessment";
import {
  computeTotalScore,
  lookupRiskLevel,
  computeNextDueDate,
  computeAcuityComposite,
  mapMorseToFallRisk,
  didRiskWorsen,
} from "@/lib/assessments/scoring";
import type { AssessmentTemplate, AssessmentTemplateItem } from "@/lib/assessments/types";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

const TYPE_LABELS: Record<string, string> = {
  katz_adl: "Katz ADL Index",
  morse_fall: "Morse Fall Scale",
  braden: "Braden Scale",
  phq9: "PHQ-9 Depression Screen",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-success/10 text-success",
  standard: "bg-warning/10 text-warning",
  high: "bg-destructive/10 text-destructive",
  level_1: "bg-success/10 text-success",
  level_2: "bg-warning/10 text-warning",
  level_3: "bg-destructive/10 text-destructive",
  none: "bg-success/10 text-success",
  mild: "bg-success/10 text-success",
  moderate: "bg-warning/10 text-warning",
  very_high: "bg-destructive/10 text-destructive",
  minimal: "bg-success/10 text-success",
  moderately_severe: "bg-warning/10 text-warning",
  severe: "bg-destructive/10 text-destructive",
};

function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AssessmentEntryPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, appRole } = useHavenAuth();

  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [residentName, setResidentName] = useState("");
  const [facilityId, setFacilityId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("");

  const form = useForm<AssessmentFormData>({
    resolver: zodResolver(assessmentFormSchema),
    defaultValues: {
      assessmentType: "",
      assessmentDate: todayLocal(),
      scores: {},
      notes: "",
    },
  });

  const watchScores = form.watch("scores");

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.assessment_type === selectedType) ?? null,
    [templates, selectedType],
  );

  const liveTotal = useMemo(() => {
    if (!selectedTemplate) return null;
    const itemKeys = selectedTemplate.items.map((i) => i.key);
    const answered = itemKeys.filter((k) => watchScores[k] !== undefined);
    if (answered.length === 0) return null;
    return computeTotalScore(watchScores);
  }, [watchScores, selectedTemplate]);

  const liveRiskLevel = useMemo(() => {
    if (liveTotal === null || !selectedTemplate) return null;
    return lookupRiskLevel(liveTotal, selectedTemplate.risk_thresholds);
  }, [liveTotal, selectedTemplate]);

  const allAnswered = useMemo(() => {
    if (!selectedTemplate) return false;
    return selectedTemplate.items.every((item) => watchScores[item.key] !== undefined);
  }, [watchScores, selectedTemplate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!organizationId) throw new Error("No organization on profile");

      const { data: resident } = await supabase
        .from("residents")
        .select("first_name, last_name, facility_id")
        .eq("id", residentId)
        .maybeSingle();
      if (!resident) throw new Error("Resident not found");
      setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());
      setFacilityId(resident.facility_id);

      const { data: tpls, error: tplErr } = await supabase
        .from("assessment_templates")
        .select("*")
        .order("assessment_type");
      if (tplErr) throw new Error(tplErr.message);

      const role = appRole ?? "";
      const privilegedRoles = new Set(["owner", "org_admin"]);
      const allowed = (tpls ?? []).filter((t) => {
        if (privilegedRoles.has(role)) return true;
        const rr = t.required_role as string[] | null;
        return Array.isArray(rr) && rr.includes(role);
      }) as unknown as AssessmentTemplate[];
      setTemplates(allowed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, organizationId, appRole]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleTypeSelect(type: string) {
    setSelectedType(type);
    form.setValue("assessmentType", type);
    form.setValue("scores", {});
  }

  async function onSubmit(data: AssessmentFormData) {
    if (!selectedTemplate || !facilityId || !organizationId) return;
    setSaving(true);
    setError(null);
    try {
      if (!user) throw new Error("Not authenticated");

      const totalScore = computeTotalScore(data.scores);
      const riskLevel = lookupRiskLevel(totalScore, selectedTemplate.risk_thresholds);
      const nextDueDate = computeNextDueDate(data.assessmentDate, selectedTemplate.default_frequency_days);

      const { error: insertErr } = await supabase.from("assessments").insert({
        resident_id: residentId,
        facility_id: facilityId,
        organization_id: organizationId,
        assessment_type: data.assessmentType,
        assessment_date: data.assessmentDate,
        total_score: totalScore,
        risk_level: riskLevel,
        scores: data.scores,
        notes: data.notes || null,
        assessed_by: user.id,
        next_due_date: nextDueDate,
        created_by: user.id,
        updated_by: user.id,
      });
      if (insertErr) throw new Error(insertErr.message);

      await updateResidentFromAssessment(data.assessmentType, totalScore, riskLevel);

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assessment");
    } finally {
      setSaving(false);
    }
  }

  async function updateResidentFromAssessment(type: string, totalScore: number, riskLevel: string) {
    if (type === "morse_fall") {
      const fallRisk = mapMorseToFallRisk(totalScore);
      await supabase.from("residents").update({ fall_risk_level: fallRisk }).eq("id", residentId);
    }

    if (["katz_adl", "morse_fall", "braden"].includes(type)) {
      const { data: latestAssessments } = await supabase
        .from("assessments")
        .select("assessment_type, total_score, risk_level")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .in("assessment_type", ["katz_adl", "morse_fall", "braden"])
        .order("assessment_date", { ascending: false });

      const latest: Record<string, { total_score: number | null; risk_level: string | null }> = {};
      for (const a of latestAssessments ?? []) {
        if (!latest[a.assessment_type]) latest[a.assessment_type] = a;
      }

      const { acuityScore, acuityLevel } = computeAcuityComposite({
        katzScore: latest.katz_adl?.total_score ?? undefined,
        morseRiskLevel: latest.morse_fall?.risk_level ?? undefined,
        bradenRiskLevel: latest.braden?.risk_level ?? undefined,
      });

      await supabase.from("residents").update({
        acuity_score: acuityScore,
        acuity_level: acuityLevel,
      }).eq("id", residentId);
    }

    const { data: priorAssessments } = await supabase
      .from("assessments")
      .select("risk_level")
      .eq("resident_id", residentId)
      .eq("assessment_type", type)
      .is("deleted_at", null)
      .order("assessment_date", { ascending: false })
      .limit(2);

    const prior = priorAssessments && priorAssessments.length > 1 ? priorAssessments[1] : null;

    if (prior && didRiskWorsen(type, riskLevel, prior.risk_level)) {
      const { data: activePlan } = await supabase
        .from("care_plans")
        .select("id")
        .eq("resident_id", residentId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();

      if (activePlan) {
        const { error: alertErr } = await supabase.from("care_plan_review_alerts" as never).insert({
          care_plan_id: activePlan.id,
          resident_id: residentId,
          facility_id: facilityId,
          organization_id: organizationId,
          trigger_type: "assessment_threshold",
          trigger_detail: `${TYPE_LABELS[type] ?? type} risk changed from ${prior.risk_level} to ${riskLevel}`,
        } as never);
        const pgCode = alertErr ? (alertErr as { code?: string }).code : undefined;
        const isUniqueViolation = pgCode === "23505" || alertErr?.message?.toLowerCase().includes("unique");
        if (alertErr && !isUniqueViolation) {
          console.error("Failed to create review alert:", alertErr.message);
        }
      }
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pt-8">
        <RecordDetailSection title="Assessment saved" className="border-success/20 bg-success/10">
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="text-base font-semibold text-foreground">
              {TYPE_LABELS[selectedType] ?? selectedType} — Score: {liveTotal} — Risk: {liveRiskLevel?.replace(/_/g, " ")}
            </p>
            <div className="flex gap-3 pt-2">
              <a href={`/admin/residents/${residentId}/assessments`}>
                <Button variant="outline" size="sm">View history</Button>
              </a>
              <Button size="sm" onClick={() => { setSuccess(false); setSelectedType(""); form.reset(); }}>
                New assessment
              </Button>
            </div>
          </div>
        </RecordDetailSection>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RecordDetailHeader
        title="New assessment"
        subtitle={residentName || undefined}
        backLink={{ label: "Back to assessments", href: `/admin/residents/${residentId}/assessments` }}
      />

      <RecordDetailSection
        title="Assessment form"
        description="Select an assessment type, answer each item, and submit to record the score."
      >
        <div className="space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading templates…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
              <Button variant="ghost" size="sm" onClick={load} className="ml-2 text-destructive">
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && templates.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No assessment types available for your role.
            </div>
          )}

          {!loading && !error && templates.length > 0 && !selectedType && (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.assessment_type}
                  onClick={() => handleTypeSelect(t.assessment_type)}
                  className="rounded-[8px] border border-border bg-card px-4 py-4 text-left transition-colors duration-[var(--motion-duration-micro)] hover:border-primary/30 hover:bg-muted"
                >
                  <div className="font-medium text-foreground">{t.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t.description}</div>
                  <div className="mt-2 tabular-nums text-xs text-muted-foreground">
                    Score range: {t.score_range_min}–{t.score_range_max} · Every {t.default_frequency_days} days
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && !error && selectedTemplate && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="assessmentDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assessment date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="max-w-xs" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center gap-4 rounded-[8px] border border-border bg-muted px-4 py-3">
                  <div className="text-sm text-muted-foreground">
                    Score: <span className="tabular-nums text-lg font-semibold text-foreground">{liveTotal ?? "—"}</span>
                    <span className="text-muted-foreground"> / {selectedTemplate.score_range_max}</span>
                  </div>
                  {liveRiskLevel && (
                    <Badge className={cn("text-xs", RISK_COLORS[liveRiskLevel] ?? "bg-muted text-muted-foreground")}>
                      {liveRiskLevel.replace(/_/g, " ")}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-xs text-muted-foreground"
                    onClick={() => { setSelectedType(""); form.setValue("scores", {}); }}
                  >
                    Change type
                  </Button>
                </div>

                <div className="space-y-5">
                  {selectedTemplate.items.map((item: AssessmentTemplateItem) => (
                    <FormField
                      key={item.key}
                      control={form.control}
                      name={`scores.${item.key}`}
                      render={({ field }) => (
                        <FormItem className="rounded-[8px] border border-border bg-card p-4">
                          <FormLabel className="text-sm font-medium text-foreground">
                            <ClipboardCheck className="inline h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                            {item.label}
                          </FormLabel>
                          <FormControl>
                            <div className="mt-2 space-y-2">
                              {item.options.map((opt) => (
                                <label
                                  key={opt.value}
                                  className={cn(
                                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-[var(--motion-duration-micro)]",
                                    field.value === opt.value
                                      ? "border-info/60 bg-info/10 text-foreground"
                                      : "border-border text-foreground hover:border-border/80 hover:bg-muted",
                                  )}
                                >
                                  <input
                                    type="radio"
                                    name={item.key}
                                    value={opt.value}
                                    checked={field.value === opt.value}
                                    onChange={() => field.onChange(opt.value)}
                                    className="accent-cyan-500"
                                  />
                                  <span>{opt.label}</span>
                                  <span className="ml-auto tabular-nums text-xs text-muted-foreground">{opt.value}</span>
                                </label>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (optional)</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={3}
                          className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                          placeholder="Clinical observations, context for scores…"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push(`/admin/residents/${residentId}/assessments`)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving || !allAnswered}>
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Save assessment"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </div>
      </RecordDetailSection>
    </div>
  );
}
