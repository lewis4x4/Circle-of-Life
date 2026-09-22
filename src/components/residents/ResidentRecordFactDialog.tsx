"use client";

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";
import {
  CODE_STATUS_OPTIONS,
  FEEDING_TUBE_OPTIONS,
  HOSPICE_OPTIONS,
  POLST_STATUS_OPTIONS,
  RESIDENT_RECORD_FIELD_TITLES,
  formatFieldSource,
  linesToList,
  residentRecordEditErrorMessage,
  type ResidentRecordField,
  type SelectOption,
} from "@/lib/residents/resident-record-edit";
import { cn } from "@/lib/utils";

/**
 * COL-597: the editor every "record it" affordance on the resident overview
 * opens. One dialog, one field at a time, one RPC — the server applies the
 * intake reviewer rule, stamps verification with the person and the time, and
 * logs before/after with the surface. The dialog only collects the value.
 */

type SaveAction = "set" | "verify";

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Choice({ id, label, value, onChange, options, placeholder }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <select id={id} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type Draft = {
  codeStatus: string;
  codeVerified: boolean;
  allergies: string;
  noKnownAllergies: boolean;
  primaryDiagnosis: string;
  otherDiagnoses: string;
  physicianName: string;
  physicianPhone: string;
  dnh: "" | "true" | "false";
  feedingTube: string;
  feedingTubeNotes: string;
  hospice: string;
  polstType: string;
  polstStatus: string;
  polstSignedOn: string;
  polstNotes: string;
};

function initialDraft(detail: ResidentOverviewDetail): Draft {
  const known = CODE_STATUS_OPTIONS.some((o) => o.value === detail.codeStatusRaw);
  const primary = detail.primaryDiagnosisRaw ?? "";
  return {
    codeStatus: known ? (detail.codeStatusRaw ?? "") : "",
    codeVerified: false,
    allergies: detail.allergiesTokens.join("\n"),
    noKnownAllergies: false,
    primaryDiagnosis: primary,
    otherDiagnoses: detail.diagnosisListRaw.filter((d) => d !== primary).join("\n"),
    physicianName: detail.primaryPhysicianName ?? "",
    physicianPhone: detail.primaryPhysicianPhone ?? "",
    dnh: detail.doNotHospitalize == null ? "" : detail.doNotHospitalize ? "true" : "false",
    feedingTube: detail.feedingTube ?? "",
    feedingTubeNotes: detail.feedingTubeNotes ?? "",
    hospice: detail.hospiceStatus ?? "",
    polstType: "",
    polstStatus: "",
    polstSignedOn: "",
    polstNotes: "",
  };
}

/** The RPC payload for a draft, or an operator-facing reason it cannot be sent yet. */
export function buildFieldPayload(field: ResidentRecordField, d: Draft): { value: Record<string, unknown> } | { problem: string } {
  switch (field) {
    case "code_status":
      if (!d.codeStatus) return { problem: "Choose a code status." };
      return { value: { code_status: d.codeStatus, verified: d.codeVerified } };
    case "allergy_list": {
      const allergies = d.noKnownAllergies ? [] : linesToList(d.allergies);
      if (!d.noKnownAllergies && allergies.length === 0) {
        return { problem: "Enter each allergy on its own line, or tick “No known allergies”." };
      }
      return { value: { allergies } };
    }
    case "diagnoses": {
      const primary = d.primaryDiagnosis.trim();
      const others = linesToList(d.otherDiagnoses).filter((x) => x.toLowerCase() !== primary.toLowerCase());
      if (!primary && others.length === 0) return { problem: "Enter at least one diagnosis." };
      return { value: { primary_diagnosis: primary || null, diagnosis_list: others } };
    }
    case "primary_physician":
      if (!d.physicianName.trim()) return { problem: "Enter the physician's name." };
      return { value: { name: d.physicianName.trim(), phone: d.physicianPhone.trim() || null } };
    case "do_not_hospitalize":
      if (!d.dnh) return { problem: "Say whether a Do Not Hospitalize order is in effect." };
      return { value: { do_not_hospitalize: d.dnh === "true" } };
    case "feeding_tube":
      if (!d.feedingTube) return { problem: "Choose a feeding tube entry." };
      if (d.feedingTube === "other" && !d.feedingTubeNotes.trim()) return { problem: "Describe the tube." };
      return { value: { feeding_tube: d.feedingTube, notes: d.feedingTubeNotes.trim() || null } };
    case "hospice_status":
      if (!d.hospice) return { problem: "Choose a hospice election state." };
      return { value: { hospice_status: d.hospice } };
    case "polst_molst":
      if (!d.polstType || !d.polstStatus) return { problem: "Choose the form and its status." };
      return {
        value: {
          document_type: d.polstType,
          polst_status: d.polstStatus,
          physician_signature_date: d.polstSignedOn || null,
          notes: d.polstNotes.trim() || null,
        },
      };
  }
}

const HELP: Record<ResidentRecordField, string> = {
  code_status: "A new or changed code status is unverified until you tick that you checked it against the signed order.",
  allergy_list: "Saving records an allergy review by you, today. “No known allergies” is a review, not a blank.",
  diagnoses: "Saving records a diagnosis review by you, today.",
  primary_physician: "The physician responsible for this resident's care.",
  do_not_hospitalize: "Whether a Do Not Hospitalize order is in effect — separate from code status.",
  feeding_tube: "Record “No feeding tube” when you have checked; leaving it unrecorded is not the same.",
  hospice_status: "The resident's current hospice election.",
  polst_molst:
    "Records that the form exists and what it says. Upload the signed form through Admission documents so the scan keeps its source.",
};

export function ResidentRecordFactDialog({
  field,
  detail,
  onOpenChange,
  onSaved,
}: {
  field: ResidentRecordField | null;
  detail: ResidentOverviewDetail;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(detail));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per opened editor: a retried click is the same request, not a second write.
  const requestKey = useRef<string>("");

  useEffect(() => {
    if (!field) return;
    setDraft(initialDraft(detail));
    setProblem(null);
    requestKey.current = crypto.randomUUID();
    // Only when a different editor opens; a reload of `detail` must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  if (!field) return null;
  const state = detail.fieldStates?.[field] ?? null;
  const canEdit = state?.canEdit === true;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const canVerify =
    (field === "code_status" && Boolean(detail.codeStatusRaw) && !detail.codeStatusVerifiedAt) ||
    (field === "allergy_list" && !detail.allergyReviewedAt && detail.allergiesTokens.length > 0) ||
    (field === "diagnoses" && !detail.diagnosesReviewedAt && detail.diagnosisRawList.length > 0);

  async function save(action: SaveAction) {
    if (!field || saving) return;
    setProblem(null);
    let value: Record<string, unknown> | null = null;
    if (action === "set") {
      const built = buildFieldPayload(field, draft);
      if ("problem" in built) {
        setProblem(built.problem);
        return;
      }
      value = built.value;
    }
    if (!detail.updatedAt) {
      setProblem("This record's version could not be read. Refresh the page and try again.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("resident_record_field_save" as never, {
        p_resident_id: detail.id,
        p_field_code: field,
        p_action: action,
        p_value: value,
        p_expected_updated_at: detail.updatedAt,
        p_request_key: requestKey.current,
        p_surface: "resident_record",
      } as never);
      if (error) throw error;
      toast.success(`${RESIDENT_RECORD_FIELD_TITLES[field]} ${action === "verify" ? "verified" : "recorded"} for ${detail.fullName}.`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setProblem(residentRecordEditErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const id = (suffix: string) => `rr-${field}-${suffix}`;

  return (
    <Dialog open onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle>
            {RESIDENT_RECORD_FIELD_TITLES[field]} — {detail.fullName}
          </DialogTitle>
          <DialogDescription>{HELP[field]}</DialogDescription>
        </DialogHeader>

        <p className="text-[12px] text-muted-foreground" data-testid="field-source">
          Current value: {formatFieldSource(state?.source ?? null)}
        </p>

        {!canEdit ? (
          <p role="status" className="rounded-md bg-muted p-3 text-[13px]">
            {detail.fieldStates
              ? "Your role can't record this on the resident record. A clinical reviewer can — or it can arrive through Admission documents."
              : "Editing is unavailable right now: the record could not confirm who may change this. Refresh and try again."}
          </p>
        ) : (
          <fieldset disabled={saving} className="space-y-3">
            {field === "code_status" ? (
              <>
                <Choice id={id("value")} label="Code status" value={draft.codeStatus} onChange={(v) => set("codeStatus", v)}
                  options={CODE_STATUS_OPTIONS} placeholder="Choose a code status" />
                {detail.codeStatusRaw && !CODE_STATUS_OPTIONS.some((o) => o.value === detail.codeStatusRaw) ? (
                  <p className="text-[12px] text-muted-foreground">On file as entered: “{detail.codeStatusRaw}”.</p>
                ) : null}
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="mt-0.5" checked={draft.codeVerified} onChange={(e) => set("codeVerified", e.target.checked)} />
                  I checked this against the signed order or directive
                </label>
              </>
            ) : null}

            {field === "allergy_list" ? (
              <>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="mt-0.5" checked={draft.noKnownAllergies} onChange={(e) => set("noKnownAllergies", e.target.checked)} />
                  No known allergies (reviewed)
                </label>
                {!draft.noKnownAllergies ? (
                  <div className="space-y-1.5">
                    <FormLabel htmlFor={id("list")}>Allergies, one per line</FormLabel>
                    <Textarea id={id("list")} rows={4} value={draft.allergies} onChange={(e) => set("allergies", e.target.value)} />
                  </div>
                ) : null}
              </>
            ) : null}

            {field === "diagnoses" ? (
              <>
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("primary")}>Primary diagnosis</FormLabel>
                  <Input id={id("primary")} value={draft.primaryDiagnosis} onChange={(e) => set("primaryDiagnosis", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("others")}>Other diagnoses, one per line</FormLabel>
                  <Textarea id={id("others")} rows={4} value={draft.otherDiagnoses} onChange={(e) => set("otherDiagnoses", e.target.value)} />
                </div>
              </>
            ) : null}

            {field === "primary_physician" ? (
              <>
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("name")}>Name</FormLabel>
                  <Input id={id("name")} value={draft.physicianName} onChange={(e) => set("physicianName", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("phone")}>Phone</FormLabel>
                  <Input id={id("phone")} inputMode="tel" value={draft.physicianPhone} onChange={(e) => set("physicianPhone", e.target.value)} />
                </div>
              </>
            ) : null}

            {field === "do_not_hospitalize" ? (
              <Choice id={id("value")} label="Do Not Hospitalize order" value={draft.dnh} onChange={(v) => set("dnh", v as Draft["dnh"])}
                options={[{ value: "true", label: "In effect" }, { value: "false", label: "Not in effect" }]} placeholder="Choose one" />
            ) : null}

            {field === "feeding_tube" ? (
              <>
                <Choice id={id("value")} label="Feeding tube" value={draft.feedingTube} onChange={(v) => set("feedingTube", v)}
                  options={FEEDING_TUBE_OPTIONS} placeholder="Choose one" />
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("notes")}>Details (placement date, size, care)</FormLabel>
                  <Textarea id={id("notes")} rows={3} value={draft.feedingTubeNotes} onChange={(e) => set("feedingTubeNotes", e.target.value)} />
                </div>
              </>
            ) : null}

            {field === "hospice_status" ? (
              <Choice id={id("value")} label="Hospice election" value={draft.hospice} onChange={(v) => set("hospice", v)}
                options={HOSPICE_OPTIONS} placeholder="Choose one" />
            ) : null}

            {field === "polst_molst" ? (
              <>
                <Choice id={id("type")} label="Form" value={draft.polstType} onChange={(v) => set("polstType", v)}
                  options={[{ value: "polst", label: "POLST" }, { value: "molst", label: "MOLST" }]} placeholder="Choose the form" />
                <Choice id={id("status")} label="Status" value={draft.polstStatus} onChange={(v) => set("polstStatus", v)}
                  options={POLST_STATUS_OPTIONS} placeholder="Choose a status" />
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("signed")}>Physician signature date</FormLabel>
                  <Input id={id("signed")} type="date" value={draft.polstSignedOn} onChange={(e) => set("polstSignedOn", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor={id("pnotes")}>Notes</FormLabel>
                  <Textarea id={id("pnotes")} rows={2} value={draft.polstNotes} onChange={(e) => set("polstNotes", e.target.value)} />
                </div>
              </>
            ) : null}
          </fieldset>
        )}

        {problem ? (
          <p role="alert" className="text-[13px] text-destructive">
            {problem}
          </p>
        ) : null}

        <DialogFooter className={cn("gap-2")}>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && canVerify ? (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void save("verify")}>
              {field === "code_status" ? "Verify as recorded" : "Mark reviewed as recorded"}
            </Button>
          ) : null}
          {canEdit ? (
            <Button type="button" disabled={saving} onClick={() => void save("set")}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
