"use client";

import { useMemo, useState } from "react";
import { Loader2, Mic, MicOff, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompletionPayload, ObservationExceptionType, ObservationQuickStatus } from "@/lib/rounding/types";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "@/lib/grace/voice/useGraceVoiceRecorder";
import { graceSpeak } from "@/lib/grace/voice/tts";

const QUICK_STATUS_OPTIONS: { value: ObservationQuickStatus; label: string }[] = [
  { value: "awake", label: "Awake" },
  { value: "asleep", label: "Asleep" },
  { value: "calm", label: "Calm" },
  { value: "agitated", label: "Agitated" },
  { value: "confused", label: "Confused" },
  { value: "distressed", label: "Distressed" },
  { value: "not_found", label: "Not found" },
  { value: "refused", label: "Refused" },
];

const EXCEPTION_OPTIONS: { value: ObservationExceptionType; label: string }[] = [
  { value: "resident_not_found", label: "Resident not found" },
  { value: "resident_declined_interaction", label: "Resident declined interaction" },
  { value: "resident_appears_ill", label: "Resident appears ill" },
  { value: "resident_appears_injured", label: "Resident appears injured" },
  { value: "environmental_hazard_present", label: "Environmental hazard present" },
  { value: "family_concern_reported", label: "Family concern reported" },
  { value: "assignment_impossible", label: "Assignment impossible" },
  { value: "other", label: "Other" },
];

function hasAbnormalStatus(status: ObservationQuickStatus) {
  return status === "agitated" || status === "confused" || status === "distressed" || status === "not_found" || status === "refused";
}

function parseVoiceCheckoff(transcript: string) {
  const normalized = transcript.toLowerCase();
  const quickStatus: ObservationQuickStatus =
    normalized.includes("distress")
      ? "distressed"
      : normalized.includes("confus")
        ? "confused"
        : normalized.includes("agit")
          ? "agitated"
          : normalized.includes("not found")
            ? "not_found"
            : normalized.includes("refused")
              ? "refused"
              : normalized.includes("sleep") || normalized.includes("asleep")
                ? "asleep"
                : normalized.includes("calm")
                  ? "calm"
                  : "awake";

  return {
    quickStatus,
    hydrationOffered: normalized.includes("hydration"),
    toiletingAssisted: normalized.includes("toilet"),
    repositioned: normalized.includes("reposition"),
    fallHazardObserved: normalized.includes("hazard") || normalized.includes("fall risk"),
    exceptionType:
      normalized.includes("not found")
        ? ("resident_not_found" as const)
        : normalized.includes("refused")
          ? ("resident_declined_interaction" as const)
          : normalized.includes("hazard")
            ? ("environmental_hazard_present" as const)
            : null,
  };
}

export function QuickObservationForm({
  residentName,
  dueLabel,
  submitting,
  onSubmit,
}: {
  residentName: string;
  dueLabel: string;
  submitting?: boolean;
  onSubmit: (payload: CompletionPayload) => Promise<void> | void;
}) {
  const [quickStatus, setQuickStatus] = useState<ObservationQuickStatus>("awake");
  const [residentLocation, setResidentLocation] = useState("in room");
  const [residentPosition, setResidentPosition] = useState("in bed");
  const [residentState, setResidentState] = useState("resting comfortably");
  const [lateReason, setLateReason] = useState("");
  const [note, setNote] = useState("");
  const [exceptionType, setExceptionType] = useState<ObservationExceptionType | "">("");
  const [hydrationOffered, setHydrationOffered] = useState(false);
  const [toiletingAssisted, setToiletingAssisted] = useState(false);
  const [repositioned, setRepositioned] = useState(false);
  const [fallHazardObserved, setFallHazardObserved] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceRecorder = useGraceVoiceRecorder();

  const needsDetails = useMemo(
    () => hasAbnormalStatus(quickStatus) || !!exceptionType || fallHazardObserved || note.length > 0,
    [exceptionType, fallHazardObserved, note.length, quickStatus],
  );

  async function toggleVoiceCapture() {
    setVoiceError(null);

    if (!voiceRecorder.supported) {
      setVoiceError("Voice capture is not supported in this browser.");
      return;
    }

    if (!voiceRecorder.recording) {
      const started = await voiceRecorder.start();
      if (!started) {
        setVoiceError(voiceRecorder.error ?? "Microphone access failed.");
      }
      return;
    }

    setVoiceBusy(true);
    try {
      const audio = await voiceRecorder.stop();
      if (!audio) throw new Error("No audio captured.");
      const transcript = await transcribeGraceAudio(audio);
      setVoiceTranscript(transcript);
      const parsed = parseVoiceCheckoff(transcript);
      setQuickStatus(parsed.quickStatus);
      setHydrationOffered(parsed.hydrationOffered);
      setToiletingAssisted(parsed.toiletingAssisted);
      setRepositioned(parsed.repositioned);
      setFallHazardObserved(parsed.fallHazardObserved);
      if (parsed.exceptionType) setExceptionType(parsed.exceptionType);
      setNote((current) => {
        const prefix = `Voice check-off: ${transcript}`;
        return current.includes(prefix) ? current : [prefix, current].filter(Boolean).join("\n");
      });
      await graceSpeak(`Voice check-off captured. Status set to ${parsed.quickStatus.replaceAll("_", " ")}.`);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Voice check-off failed.");
    } finally {
      setVoiceBusy(false);
    }
  }

  async function submitForm() {
    const payload: CompletionPayload = {
      quickStatus,
      residentLocation,
      residentPosition,
      residentState,
      hydrationOffered,
      toiletingAssisted,
      repositioned,
      fallHazardObserved,
      note: note.trim() || null,
      lateReason: lateReason.trim() || null,
      exceptionType: exceptionType || null,
      distressPresent: quickStatus === "distressed",
      refusedAssistance: quickStatus === "refused",
    };
    try {
      await onSubmit(payload);
    } catch (err) {
      console.error("[QuickObservationForm] onSubmit rejected", err);
    }
  }

  return (
    <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Quick round for {residentName}</CardTitle>
        <CardDescription className="text-zinc-400">{dueLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Voice check-off</p>
              <p className="text-sm text-zinc-300">Record a quick spoken round note and let Haven prefill the check-off.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={voiceRecorder.recording ? "destructive" : "outline"}
                className="min-h-11"
                onClick={() => void toggleVoiceCapture()}
                disabled={voiceBusy}
              >
                {voiceBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : voiceRecorder.recording ? (
                  <MicOff className="mr-2 h-4 w-4" />
                ) : (
                  <Mic className="mr-2 h-4 w-4" />
                )}
                {voiceRecorder.recording ? "Stop" : "Record"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => void graceSpeak(`Ready for ${residentName} round check-off.`)}
              >
                <Volume2 className="mr-2 h-4 w-4" />
                Prompt
              </Button>
            </div>
          </div>
          {voiceTranscript ? (
            <p className="rounded-md bg-black/20 px-3 py-2 text-sm text-zinc-300">{voiceTranscript}</p>
          ) : null}
          {voiceError ? <p className="text-sm text-rose-300">{voiceError}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Quick status</label>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={quickStatus === option.value}
                onClick={() => setQuickStatus(option.value)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  quickStatus === option.value
                    ? "border-emerald-500 bg-emerald-950/50 text-emerald-100"
                    : "border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Location"
            value={residentLocation}
            onChange={setResidentLocation}
            options={["in room", "common area", "out of room", "off unit", "appointment"]}
          />
          <Field
            label="Position"
            value={residentPosition}
            onChange={setResidentPosition}
            options={["in bed", "in chair", "ambulating", "with staff"]}
          />
        </div>

        {needsDetails ? (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
            <Field
              label="Resident presentation"
              value={residentState}
              onChange={setResidentState}
              options={["resting comfortably", "calm", "agitated", "confused", "distressed", "needs follow-up"]}
            />

            <Field
              label="Exception"
              value={exceptionType}
              onChange={(value) => setExceptionType(value as ObservationExceptionType | "")}
              options={["", ...EXCEPTION_OPTIONS.map((option) => option.value)]}
              labels={Object.fromEntries(EXCEPTION_OPTIONS.map((option) => [option.value, option.label]))}
            />

            <div className="grid grid-cols-2 gap-2 text-sm text-zinc-200">
              <ToggleChip label="Hydration offered" checked={hydrationOffered} onChange={setHydrationOffered} />
              <ToggleChip label="Toileting assisted" checked={toiletingAssisted} onChange={setToiletingAssisted} />
              <ToggleChip label="Repositioned" checked={repositioned} onChange={setRepositioned} />
              <ToggleChip label="Fall hazard seen" checked={fallHazardObserved} onChange={setFallHazardObserved} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Note</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                placeholder="Add exception or intervention details when needed"
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Late entry reason (if needed)</label>
          <input
            value={lateReason}
            onChange={(event) => setLateReason(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600"
            placeholder="Required only for late entries"
          />
        </div>

        <Button
          type="button"
          size="lg"
          className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() => void submitForm()}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Complete round
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
      >
        {options.map((option) => (
          <option key={option || "__empty"} value={option}>
            {(labels?.[option] ?? option) || "None"}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`min-h-11 rounded-lg border px-3 py-2 text-left transition-colors ${
        checked ? "border-emerald-700 bg-emerald-950/40 text-emerald-100" : "border-zinc-800 bg-zinc-950 text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
