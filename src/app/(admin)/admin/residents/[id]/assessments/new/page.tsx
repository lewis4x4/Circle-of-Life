"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const TYPE_LABELS: Record<string, string> = {
  katz_adl: "Katz ADL Index",
  morse_fall: "Morse Fall Scale",
  braden: "Braden Scale",
  phq9: "PHQ-9 Depression Screen",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-900/60 text-emerald-200",
  standard: "bg-amber-900/60 text-amber-200",
  high: "bg-red-900/60 text-red-200",
  level_1: "bg-emerald-900/60 text-emerald-200",
  level_2: "bg-amber-900/60 text-amber-200",
  level_3: "bg-red-900/60 text-red-200",
  none: "bg-emerald-900/60 text-emerald-200",
  mild: "bg-emerald-900/60 text-emerald-200",
  moderate: "bg-amber-900/60 text-amber-200",
  very_high: "bg-red-900/60 text-red-200",
  minimal: "bg-emerald-900/60 text-emerald-200",
  moderately_severe: "bg-orange-900/60 text-orange-200",
  severe: "bg-red-900/60 text-red-200",
};

function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AssessmentEntryPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [residentName, setResidentName] = useState("");
  const [facilityId, setFacilityId] = useState<string>("");
  const [organizationId, setOrganizationId] = useState<string>("");
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
      // Get user role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("app_role, organization_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile) throw new Error("No user profile");
      setOrganizationId(profile.organization_id ?? "");

      // Get resident + facility
      const { data: resident } = await supabase
        .from("residents")
        .select("first_name, last_name, facility_id")
        .eq("id", residentId)
        .maybeSingle();
      if (!resident) throw new Error("Resident not found");
      setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());
      setFacilityId(resident.facility_id);

      // Load templates, filter by user role
      const { data: tpls, error: tplErr } = await supabase
        .from("assessment_templates")
        .select("*")
        .order("assessment_type");
      if (tplErr) throw new Error(tplErr.message);

      const role = profile.app_role ?? "";
      // Seed templates only list nurse/caregiver/facility_admin; owner/org_admin must see catalog too.
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
  }, [supabase, residentId]);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const totalScore = computeTotalScore(data.scores);
      const riskLevel = lookupRiskLevel(totalScore, selectedTemplate.risk_thresholds);
      const nextDueDate = computeNextDueDate(data.assessmentDate, selectedTemplate.default_frequency_days);

      // Insert assessment
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

      // Post-save: update resident acuity + fall risk
      await updateResidentFromAssessment(data.assessmentType, totalScore, riskLevel);

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assessment");
    } finally {
      setSaving(false);
    }
  }

  async function updateResidentFromAssessment(type: string, totalScore: number, riskLevel: string) {
    // Update fall_risk_level if Morse Fall
    if (type === "morse_fall") {
      const fallRisk = mapMorseToFallRisk(totalScore);
      await supabase.from("residents").update({ fall_risk_level: fallRisk }).eq("id", residentId);
    }

    // Recompute acuity if Katz, Morse, or Braden
    if (["katz_adl", "morse_fall", "braden"].includes(type)) {
      // Fetch latest of each type
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

    // Check if risk worsened → create review alert
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
      // Find active care plan for this resident
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
        // idx_cpra_dedup: ignore unique violation when an open/acknowledged alert already exists
        const pgCode = alertErr ? (alertErr as { code?: string }).code : undefined;
        const isUniqueViolation = pgCode === "23505" || alertErr?.message?.toLowerCase().includes("unique");
        if (alertErr && !isUniqueViolation) {
          console.error("Failed to create review alert:", alertErr.message);
        }
      }
    }
  }

  // --- Render ---

  if (success) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pt-8">
        <Card className="border-emerald-700/50 bg-emerald-950/30">
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <CardTitle className="text-xl text-emerald-100">Assessment Saved</CardTitle>
            <CardDescription className="text-emerald-300/80">
              {TYPE_LABELS[selectedType] ?? selectedType} — Score: {liveTotal} — Risk: {liveRiskLevel?.replace(/_/g, " ")}
            </CardDescription>
            <div className="flex gap-3 pt-2">
              <Link href={`/admin/residents/${residentId}/assessments`}>
                <Button variant="outline" size="sm">View History</Button>
              </Link>
              <Button size="sm" onClick={() => { setSuccess(false); setSelectedType(""); form.reset(); }}>
                New Assessment
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/residents/${residentId}/assessments`}
          className={cn("inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200")}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Assessments
        </Link>
      </div>

      <Card className="border-slate-700/50 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
            <ClipboardCheck className="h-5 w-5 text-cyan-400" />
            New Assessment{residentName ? ` — ${residentName}` : ""}
          </CardTitle>
          <CardDescription className="text-slate-400">
            Select an assessment type, answer each item, and submit to record the score.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading templates…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
              <Button variant="ghost" size="sm" onClick={load} className="ml-2 text-red-300">
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && templates.length === 0 && (
            <div className="py-8 text-center text-slate-400">
              No assessment types available for your role.
            </div>
          )}

          {!loading && !error && templates.length > 0 && !selectedType && (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.assessment_type}
                  onClick={() => handleTypeSelect(t.assessment_type)}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-4 py-4 text-left transition hover:border-cyan-600/50 hover:bg-slate-800"
                >
                  <div className="font-medium text-slate-100">{t.name}</div>
                  <div className="mt-1 text-sm text-slate-400">{t.description}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Score range: {t.score_range_min}–{t.score_range_max} · Every {t.default_frequency_days} days
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && !error && selectedTemplate && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Assessment date */}
                <FormField
                  control={form.control}
                  name="assessmentDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">Assessment Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="max-w-xs bg-slate-800 text-slate-100" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Live score bar */}
                <div className="flex items-center gap-4 rounded-lg border border-slate-700/50 bg-slate-800/50 px-4 py-3">
                  <div className="text-sm text-slate-400">
                    Score: <span className="font-mono text-lg text-slate-100">{liveTotal ?? "—"}</span>
                    <span className="text-slate-500"> / {selectedTemplate.score_range_max}</span>
                  </div>
                  {liveRiskLevel && (
                    <Badge className={cn("text-xs", RISK_COLORS[liveRiskLevel] ?? "bg-slate-700 text-slate-300")}>
                      {liveRiskLevel.replace(/_/g, " ")}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-xs text-slate-500"
                    onClick={() => { setSelectedType(""); form.setValue("scores", {}); }}
                  >
                    Change type
                  </Button>
                </div>

                {/* Assessment items */}
                <div className="space-y-5">
                  {selectedTemplate.items.map((item: AssessmentTemplateItem) => (
                    <FormField
                      key={item.key}
                      control={form.control}
                      name={`scores.${item.key}`}
                      render={({ field }) => (
                        <FormItem className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4">
                          <FormLabel className="text-sm font-medium text-slate-200">{item.label}</FormLabel>
                          <FormControl>
                            <div className="mt-2 space-y-2">
                              {item.options.map((opt) => (
                                <label
                                  key={opt.value}
                                  className={cn(
                                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition",
                                    field.value === opt.value
                                      ? "border-cyan-600/60 bg-cyan-950/30 text-cyan-100"
                                      : "border-slate-700/40 text-slate-300 hover:border-slate-600",
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
                                  <span className="ml-auto font-mono text-xs text-slate-500">{opt.value}</span>
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

                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">Notes (optional)</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={3}
                          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                          placeholder="Clinical observations, context for scores…"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Submit */}
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
                      "Save Assessment"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
