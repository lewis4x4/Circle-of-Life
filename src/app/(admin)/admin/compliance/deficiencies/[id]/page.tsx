"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";

export default function DeficiencyDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { user } = useHavenAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [def, setDef] = useState<{
    id: string;
    survey_date: string;
    survey_type: string;
    surveyor_name: string | null;
    surveyor_agency: string;
    tag_number: string;
    tag_description: string;
    severity: string;
    scope: string;
    description: string;
    status: string;
    facility_id: string;
  } | null>(null);

  const [pocId, setPocId] = useState<string | null>(null);
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [responsibleParty, setResponsibleParty] = useState("");
  const [pocStatus, setPocStatus] = useState("draft");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: d, error: dErr } = await supabase
        .from("survey_deficiencies")
        .select(
          "id, survey_date, survey_type, surveyor_name, surveyor_agency, tag_number, tag_description, severity, scope, description, status, facility_id",
        )
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

      if (dErr || !d) {
        setError(dErr?.message ?? "Deficiency not found.");
        setDef(null);
        return;
      }
      setDef(d);

      const { data: pocs } = await supabase
        .from("plans_of_correction")
        .select("id, corrective_action, responsible_party, status")
        .eq("deficiency_id", id)
        .is("deleted_at", null)
        .in("status", ["draft", "submitted", "accepted"])
        .limit(1);

      const p = pocs?.[0];
      if (p) {
        setPocId(p.id);
        setCorrectiveAction(p.corrective_action);
        setResponsibleParty(p.responsible_party);
        setPocStatus(p.status);
      } else {
        setPocId(null);
        setCorrectiveAction("");
        setResponsibleParty("");
        setPocStatus("draft");
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePoc() {
    if (!pocId || !def) return;
    setSaving(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("plans_of_correction")
        .update({
          corrective_action: correctiveAction,
          responsible_party: responsibleParty,
          status: pocStatus,
          updated_by: user?.id ?? null,
        })
        .eq("id", pocId);
      if (upErr) setError(upErr.message);
      else await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (error && !def) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "outline" }))}>
          Back
        </Link>
      </div>
    );
  }

  if (!def) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RecordDetailHeader
        title={def.tag_number}
        subtitle={`${def.tag_description} · ${def.survey_date} · ${def.survey_type}`}
        backLink={{ label: "Compliance", href: "/admin/compliance" }}
      />

      <RecordDetailSection title="Finding">
        <p className="text-sm text-muted-foreground">{def.description}</p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Severity:</dt>
            <dd className="font-medium text-foreground">{def.severity}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Scope:</dt>
            <dd className="text-foreground">{def.scope}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Status:</dt>
            <dd className="font-medium text-foreground">{def.status}</dd>
          </div>
        </dl>
      </RecordDetailSection>

      {pocId ? (
        <RecordDetailSection title="Plan of correction">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ca">Corrective action</Label>
              <textarea
                id="ca"
                className="min-h-[100px] w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={correctiveAction}
                onChange={(e) => setCorrectiveAction(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp">Responsible party</Label>
              <Input id="rp" value={responsibleParty} onChange={(e) => setResponsibleParty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ps">POC status</Label>
              <select
                id="ps"
                className="flex h-9 w-full rounded-[8px] border border-border bg-background px-3 text-sm text-foreground"
                value={pocStatus}
                onChange={(e) => setPocStatus(e.target.value)}
              >
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="revised">Revised</option>
              </select>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="button" disabled={saving} onClick={() => void savePoc()}>
              {saving ? "Saving…" : "Save POC"}
            </Button>
          </div>
        </RecordDetailSection>
      ) : (
        <p className="text-sm text-muted-foreground">No active Plan of Correction row found for this deficiency.</p>
      )}
    </div>
  );
}
