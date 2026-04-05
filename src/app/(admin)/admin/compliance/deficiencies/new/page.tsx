"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays, format } from "date-fns";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function NewDeficiencyPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [surveyDate, setSurveyDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [surveyType, setSurveyType] = useState("routine");
  const [surveyorName, setSurveyorName] = useState("");
  const [surveyorAgency, setSurveyorAgency] = useState("AHCA");
  const [tagNumber, setTagNumber] = useState("");
  const [tagDescription, setTagDescription] = useState("");
  const [severity, setSeverity] = useState("standard");
  const [scope, setScope] = useState("isolated");
  const [description, setDescription] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (!tagNumber.trim() || !tagDescription.trim() || !description.trim()) {
      setError("Tag number, tag description, and finding description are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const fac = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
      if (fac.error || !fac.data?.organization_id) {
        setError("Could not resolve organization for facility.");
        return;
      }
      const orgId = fac.data.organization_id;
      const sd = new Date(`${surveyDate}T12:00:00`);
      const submissionDue = format(addDays(sd, 10), "yyyy-MM-dd");
      const completionTarget = format(addDays(sd, 60), "yyyy-MM-dd");

      const { data: def, error: defErr } = await supabase
        .from("survey_deficiencies")
        .insert({
          facility_id: selectedFacilityId,
          organization_id: orgId,
          survey_date: surveyDate,
          survey_type: surveyType,
          surveyor_name: surveyorName.trim() || null,
          surveyor_agency: surveyorAgency.trim() || "AHCA",
          tag_number: tagNumber.trim(),
          tag_description: tagDescription.trim(),
          severity,
          scope,
          description: description.trim(),
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();

      if (defErr || !def) {
        setError(defErr?.message ?? "Could not create deficiency.");
        return;
      }

      const { error: pocErr } = await supabase.from("plans_of_correction").insert({
        deficiency_id: def.id,
        facility_id: selectedFacilityId,
        organization_id: orgId,
        corrective_action: "To be documented in the Plan of Correction.",
        responsible_party: "Facility administrator",
        monitoring_plan: null,
        policy_changes: null,
        monitoring_frequency: null,
        submission_due_date: submissionDue,
        completion_target_date: completionTarget,
        status: "draft",
        created_by: user.id,
        updated_by: user.id,
      });

      if (pocErr) {
        setError(pocErr.message);
        return;
      }

      router.push(`/admin/compliance/deficiencies/${def.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Select a facility to record deficiencies.</p>
        <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to compliance
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/admin/compliance" className="text-sm text-slate-600 underline-offset-4 hover:underline dark:text-slate-400">
          ← Compliance
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">New deficiency</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Creates a deficiency and a draft Plan of Correction (POC due 10 days after survey date).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Survey context</CardTitle>
          <CardDescription>Match the survey visit you are documenting.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="survey_date">Survey date</Label>
                <Input
                  id="survey_date"
                  type="date"
                  value={surveyDate}
                  onChange={(e) => setSurveyDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="survey_type">Survey type</Label>
                <select
                  id="survey_type"
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
                  value={surveyType}
                  onChange={(e) => setSurveyType(e.target.value)}
                >
                  <option value="routine">Routine</option>
                  <option value="complaint">Complaint</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="change_of_ownership">Change of ownership</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="surveyor_name">Surveyor name</Label>
                <Input id="surveyor_name" value={surveyorName} onChange={(e) => setSurveyorName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surveyor_agency">Surveyor agency</Label>
                <Input id="surveyor_agency" value={surveyorAgency} onChange={(e) => setSurveyorAgency(e.target.value)} />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Citation</h2>
              <div className="mt-4 grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tag_number">Tag number</Label>
                  <Input id="tag_number" value={tagNumber} onChange={(e) => setTagNumber(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tag_description">Tag description</Label>
                  <Input id="tag_description" value={tagDescription} onChange={(e) => setTagDescription(e.target.value)} required />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="severity">Severity</Label>
                    <select
                      id="severity"
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      <option value="minor">Minor</option>
                      <option value="standard">Standard</option>
                      <option value="serious">Serious</option>
                      <option value="immediate_jeopardy">Immediate jeopardy</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scope">Scope</Label>
                    <select
                      id="scope"
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    >
                      <option value="isolated">Isolated</option>
                      <option value="pattern">Pattern</option>
                      <option value="widespread">Widespread</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Specific finding</Label>
                  <textarea
                    id="description"
                    className="min-h-[120px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Create deficiency & POC draft"}
              </Button>
              <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "outline" }))}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
