"use client";

import { useState } from "react";
import { Camera, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { ResidentItem } from "./ResidentRail";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

const CATEGORIES = [
  { value: "fall",             label: "Fall" },
  { value: "skin_integrity",   label: "Skin Integrity" },
  { value: "behavior",         label: "Behavior" },
  { value: "medication_error", label: "Medication Error" },
  { value: "elopement",        label: "Elopement" },
  { value: "choking",          label: "Choking" },
  { value: "other",            label: "Other" },
] as const;

const SEVERITIES: Array<{ value: Database["public"]["Enums"]["incident_severity"]; label: string }> = [
  { value: "level_1", label: "Level 1 — minor / no injury" },
  { value: "level_2", label: "Level 2 — minor injury / repeat event" },
  { value: "level_3", label: "Level 3 — moderate injury / med error" },
  { value: "level_4", label: "Level 4 — major injury / regulatory trigger" },
];

interface IncidentModalProps {
  userId: string;
  shiftId: string;
  shiftType: "day" | "evening" | "night" | "custom";
  residents: ResidentItem[];
  onClose: () => void;
}

export function IncidentModal({ userId, shiftId, shiftType, residents, onClose }: IncidentModalProps) {
  const supabase = createClient();
  const [step, setStep]             = useState(0); // 0 details, 1 narrative, 2 done
  const [residentId, setResidentId] = useState("");
  const [category, setCategory]     = useState("");
  const [severity, setSeverity]     = useState<Database["public"]["Enums"]["incident_severity"]>("level_2");
  const [narrative, setNarrative]   = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [incidentNumber, setIncidentNumber] = useState<string | null>(null);

  const canProceed1 = residentId !== "" && category !== "";
  const canProceed2 = narrative.trim().length >= 10;

  const selectedResident = residents.find((r) => r.id === residentId);

  function handleClose() {
    setStep(0);
    setResidentId("");
    setCategory("");
    setSeverity("level_2");
    setNarrative("");
    setLocationDescription("");
    setSubmitError(null);
    setIncidentNumber(null);
    onClose();
  }

  async function submitIncident() {
    if (!selectedResident || !canProceed2 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/med-tech/incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shiftId,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; incidentNumber?: string; facilityId?: string; organizationId?: string };
      if (!response.ok || !payload.ok || !payload.incidentNumber || !payload.facilityId || !payload.organizationId) {
        throw new Error(payload.error ?? "Could not save incident.");
      }

      const incidentInsert = await supabase
        .from("incidents")
        .insert({
          resident_id: selectedResident.id,
          facility_id: payload.facilityId,
          organization_id: payload.organizationId,
          incident_number: payload.incidentNumber,
          category: category as Database["public"]["Enums"]["incident_category"],
          severity,
          status: "open",
          occurred_at: new Date().toISOString(),
          shift: shiftType,
          location_description: locationDescription.trim() || "Medication cart / med-tech workflow",
          location_type: null,
          description: narrative.trim(),
          immediate_actions: "Documented from med-tech cockpit",
          injury_occurred: category === "fall" || category === "skin_integrity" || category === "choking",
          reported_by: userId,
          created_by: userId,
        })
        .select("incident_number")
        .single();
      if (incidentInsert.error || !incidentInsert.data) {
        throw new Error(incidentInsert.error?.message ?? "Could not save incident.");
      }

      setIncidentNumber(incidentInsert.data.incident_number);
      setStep(2);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save incident.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 ring-1 ring-slate-700 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-600 to-rose-600 flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Capture Incident</h2>
              <p className="text-xs text-slate-400">
                {step === 0 ? "Step 1 of 2 · Resident + Category" : step === 1 ? "Step 2 of 2 · Narrative" : "Submitted"}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-2 flex gap-2 border-b border-slate-800">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`flex-1 h-1.5 rounded-full transition ${
                i <= step
                  ? "bg-gradient-to-r from-orange-500 to-rose-500"
                  : "bg-slate-800"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="p-6 min-h-[320px]">

          {/* Step 0: Resident + Category */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Resident
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {residents.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setResidentId(r.id)}
                      className={`rounded-xl p-3 text-left ring-1 transition ${
                        residentId === r.id
                          ? "bg-violet-500/20 ring-violet-500/60 text-white"
                          : "bg-slate-800/60 ring-slate-700 text-slate-300 hover:ring-slate-500"
                      }`}
                    >
                      <div className="text-sm font-semibold truncate">{r.name}</div>
                      {r.room !== "-" && (
                        <div className="text-xs text-slate-500 font-mono mt-0.5">Room {r.room}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setCategory(c.value)}
                      className={`rounded-xl px-3 py-2.5 text-sm text-left ring-1 transition font-medium ${
                        category === c.value
                          ? "bg-orange-500/20 ring-orange-500/60 text-orange-200"
                          : "bg-slate-800/60 ring-slate-700 text-slate-300 hover:ring-slate-500"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Severity
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {SEVERITIES.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setSeverity(item.value)}
                      className={`rounded-xl px-3 py-2.5 text-sm text-left ring-1 transition font-medium ${
                        severity === item.value
                          ? "bg-amber-500/20 ring-amber-500/60 text-amber-200"
                          : "bg-slate-800/60 ring-slate-700 text-slate-300 hover:ring-slate-500"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Narrative + Photo */}
          {step === 1 && (
            <div className="space-y-4">
              {selectedResident && (
                <div className="flex items-center gap-3 rounded-xl bg-slate-800/60 ring-1 ring-slate-700 px-4 py-3">
                  <div className="text-sm font-semibold text-white">{selectedResident.name}</div>
                  <span className="text-slate-600">·</span>
                  <span className="text-sm text-orange-300 capitalize">{category.replace("_", " ")}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Location
                </label>
                <input
                  value={locationDescription}
                  onChange={(e) => setLocationDescription(e.target.value)}
                  placeholder="Medication cart, resident room, hall, med room…"
                  className="w-full rounded-xl bg-slate-800/80 ring-1 ring-slate-700 focus:ring-violet-500 text-white text-sm placeholder-slate-500 px-4 py-3 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Narrative <span className="text-slate-600 normal-case font-normal">(min. 10 characters)</span>
                </label>
                <textarea
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  rows={5}
                  placeholder="Describe what happened, when, and any immediate actions taken…"
                  className="w-full rounded-xl bg-slate-800/80 ring-1 ring-slate-700 focus:ring-violet-500 text-white text-sm placeholder-slate-500 px-4 py-3 resize-none outline-none transition"
                />
              </div>

              <button className="w-full rounded-xl bg-slate-800/60 ring-1 ring-slate-700 hover:ring-slate-500 py-3 flex items-center justify-center gap-2 text-sm text-slate-300 transition">
                <Camera className="w-4 h-4" /> Attach photos (optional)
              </button>

              {narrative.trim().length > 0 && narrative.trim().length < 10 && (
                <div className="flex items-center gap-2 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {10 - narrative.trim().length} more characters required
                </div>
              )}
              {submitError && (
                <div className="flex items-center gap-2 text-xs text-rose-300">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Done */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center text-center py-10">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 ring-2 ring-emerald-500 flex items-center justify-center mb-5">
                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white">Incident Captured</h3>
              <p className="text-sm text-slate-400 mt-2">
                Queued for nurse review
              </p>
              <div className="mt-3 text-xs text-slate-500 font-mono capitalize">
                #{incidentNumber} · {category.replace("_", " ")} · {selectedResident?.name}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < 2 && (
          <div className="px-6 pb-6 flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium ring-1 ring-slate-700 transition"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step === 0 && canProceed1) setStep(1);
                else if (step === 1 && canProceed2) void submitIncident();
              }}
              disabled={step === 0 ? !canProceed1 : !canProceed2 || submitting}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 to-rose-600 hover:from-orange-500 hover:to-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition"
            >
              {step === 0 ? "Continue →" : submitting ? "Saving…" : "Submit Incident"}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 pb-6">
            <button
              onClick={handleClose}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition"
            >
              Back to cockpit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
