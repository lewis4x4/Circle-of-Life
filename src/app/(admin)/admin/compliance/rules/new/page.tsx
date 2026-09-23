"use client";

import { useRouter } from "next/navigation";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const PREDEFINED_RULES = [
  {
    tag_number: "220",
    tag_title: "Personal Care",
    rule_description: "ADL care plans must be current; daily ADL logs present for assigned residents",
    severity: "serious" as const,
  },
  {
    tag_number: "417",
    tag_title: "Adequate Care",
    rule_description: "PRN effectiveness documented; condition changes reported within 24 hours",
    severity: "standard" as const,
  },
  {
    tag_number: "502",
    tag_title: "Infection Control",
    rule_description: "Infection surveillance records present; staff illness tracking active",
    severity: "serious" as const,
  },
  {
    tag_number: "59A",
    tag_title: "Staffing",
    rule_description: "Appropriate staffing levels maintained based on resident acuity and census",
    severity: "standard" as const,
  },
  {
    tag_number: "58A",
    tag_title: "Administration",
    rule_description: "Records properly maintained; facility administrator accessible to staff",
    severity: "minor" as const,
  },
  {
    tag_number: "69",
    tag_title: "Resident Assessment",
    rule_description: "Comprehensive resident assessments completed within required timeframe",
    severity: "standard" as const,
  },
] as const;

export default function NewComplianceRulePage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();

  const [usePreset, setUsePreset] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState(0);
  // The preset shown in the dropdown fills every field it names on first load, not only
  // after the dropdown changes (COL-653).
  const [tagNumber, setTagNumber] = useState<string>(PREDEFINED_RULES[0].tag_number);
  const [tagTitle, setTagTitle] = useState<string>(PREDEFINED_RULES[0].tag_title);
  const [ruleDescription, setRuleDescription] = useState<string>(PREDEFINED_RULES[0].rule_description);
  const [severity, setSeverity] = useState<"minor" | "standard" | "serious" | "immediate_jeopardy">(
    PREDEFINED_RULES[0].severity,
  );
  const [facilityScoped, setFacilityScoped] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const handlePresetChange = (index: number) => {
    setSelectedPreset(index);
    const preset = PREDEFINED_RULES[index];
    setTagNumber(preset.tag_number);
    setTagTitle(preset.tag_title);
    setRuleDescription(preset.rule_description);
    setSeverity(preset.severity);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!facilityReady || !selectedFacilityId) {
      setError("No facility is in scope.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Get organization ID
      const { data: facility } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .maybeSingle();

      if (!facility?.organization_id) {
        throw new Error("Could not determine organization ID");
      }

      // Insert new rule
      const { error: insertError } = await supabase.from("compliance_rules" as never).insert({
        facility_id: facilityScoped ? selectedFacilityId : null,
        organization_id: facility.organization_id,
        tag_number: tagNumber,
        tag_title: tagTitle,
        rule_description: ruleDescription,
        check_query: "",
        severity,
        enabled: false,
      } as never);

      if (insertError) {
        throw new Error(insertError.message);
      }

      setSuccess(true);
      // Reset form
      setTimeout(() => {
        router.push("/admin/compliance/rules");
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/compliance/rules"
          aria-label="Back to compliance rules"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div>
          
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            New Compliance Rule
          </h1>
        </div>
      </div>

      {!facilityReady ? (
        <FacilityGateNotice reason="A rule is created for one building's compliance scans (or shared org-wide from a building's scope)." />
      ) : (
      <>
      {success && (
        <Card className="border-emerald-500 bg-emerald-50">
          <CardContent className="py-6 text-center">
            <Save className="mx-auto h-12 w-12 text-emerald-600 mb-4" />
            <h2 className="text-lg font-semibold text-emerald-900 mb-2">
              Rule Created Successfully
            </h2>
            <p className="text-sm text-emerald-700">Redirecting to rules list…</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500 bg-rose-50">
          <CardContent className="py-4">
            <p className="font-medium text-rose-900">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rule Configuration</CardTitle>
          <CardDescription>
            Create a new compliance rule for automated scanning.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Preset Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
              <div className="flex items-center gap-2">
                <Switch
                  id="usePreset"
                  checked={usePreset}
                  onCheckedChange={setUsePreset}
                />
                <Label htmlFor="usePreset" className="text-base font-medium">
                  Use predefined AHCA tag
                </Label>
              </div>
              {usePreset && (
                <Select
                  value={String(selectedPreset)}
                  onValueChange={(v) => handlePresetChange(Number(v))}
                >
                  <SelectTrigger aria-label="Predefined AHCA tag" className="w-[200px]">
                    <SelectValue placeholder="Select a tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {PREDEFINED_RULES.map((preset, index) => (
                      <SelectItem key={preset.tag_number} value={String(index)}>
                        Tag {preset.tag_number}: {preset.tag_title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Tag Number */}
            <div className="space-y-2">
              <Label htmlFor="tagNumber">Tag Number</Label>
              <Input
                id="tagNumber"
                value={tagNumber}
                onChange={(e) => setTagNumber(e.target.value)}
                placeholder="e.g., 220"
                required
                disabled={usePreset}
              />
            </div>

            {/* Tag Title */}
            <div className="space-y-2">
              <Label htmlFor="tagTitle">Tag Title</Label>
              <Input
                id="tagTitle"
                value={tagTitle}
                onChange={(e) => setTagTitle(e.target.value)}
                placeholder="e.g., Personal Care"
                required
                disabled={usePreset}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ruleDescription">Rule Description</Label>
              <Textarea
                id="ruleDescription"
                value={ruleDescription}
                onChange={(e) => setRuleDescription(e.target.value)}
                placeholder="Describe what this rule checks..."
                rows={3}
                required
                disabled={usePreset}
              />
            </div>

            {/* Severity */}
            <div className="space-y-2">
              <Label htmlFor="severity">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => v && setSeverity(v as typeof severity)}
                disabled={usePreset}
              >
                <SelectTrigger id="severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="serious">Serious</SelectItem>
                  <SelectItem value="immediate_jeopardy">Immediate Jeopardy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Facility Scope */}
            <div className="flex items-center gap-2">
              <Switch
                id="facilityScoped"
                checked={facilityScoped}
                onCheckedChange={setFacilityScoped}
              />
              <Label htmlFor="facilityScoped" className="text-base">
                Apply to this facility only (not organization-wide)
              </Label>
            </div>

            {/* The automated check behind a rule is set up by Haven support, never typed here (COL-652). */}
            <p className="text-xs text-muted-foreground">
              New rules save as drafts. Haven support sets up the automated check for each rule and turns it on.
            </p>

            {/* Submit */}
            <div className="flex justify-end pt-4 border-t">
              <Button
                type="submit"
                disabled={saving || !facilityReady}
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Creating…" : "Create Rule"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
