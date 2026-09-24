"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { StatusPill } from "@/components/ui/status-pill";
import {
  COVERAGE_LABELS,
  RESULT_LABELS,
  classifyAdmissionScreening,
  dollars,
  parseDollarsToCents,
  screeningQuestionText,
} from "@/lib/benefits/admission-screening";
import {
  SCREENING_COVERAGE,
  SCREENING_QUESTIONS,
  SCREENING_RESPONDENTS,
  type AdmissionGate,
  type AdmissionScreeningInput,
  type AdmissionScreeningList,
  type AdmissionScreeningReply,
  type AdmissionScreeningRow,
  type ScreeningCoverage,
  type ScreeningQuestion,
  type ScreeningResult,
} from "@/lib/benefits/contracts";
import { BenefitsRequestError, benefitsFetch, dateLabel, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

type Knowledge = "yes" | "no" | "unknown";
export interface MedicaidQuestionsDraft {
  coverage: ScreeningCoverage | "";
  coveragePlan: string;
  answers: Record<ScreeningQuestion, Knowledge | "">;
  income: string;
  assets: string;
  months: string;
  answeredBy: (typeof SCREENING_RESPONDENTS)[number] | "";
  notes: string;
}
/** Empty stays empty: nothing is pre-selected until staff record what they were told. */
export function emptyMedicaidDraft(): MedicaidQuestionsDraft {
  return {
    coverage: "", coveragePlan: "", income: "", assets: "", months: "", answeredBy: "", notes: "",
    answers: { q_property_non_primary: "", q_income_over_limit: "", q_life_insurance: "", q_burial_contract: "", q_assets: "", q_power_of_attorney: "" },
  };
}
export function medicaidDraftStarted(draft: MedicaidQuestionsDraft) {
  return draft.coverage !== "" || Object.values(draft.answers).some(Boolean) || [draft.income, draft.assets, draft.months, draft.notes].some((v) => v.trim());
}
/** Returns the payload or the first problem, in the words staff see. */
export function medicaidDraftPayload(
  draft: MedicaidQuestionsDraft,
  ids: { residentId: string; admissionCaseId?: string | null; source: AdmissionScreeningInput["source"] },
): { payload: AdmissionScreeningInput } | { problem: string } {
  if (!draft.coverage) return { problem: "Choose the resident's current coverage (Not yet known is a valid answer)." };
  const missing = SCREENING_QUESTIONS.filter((q) => !draft.answers[q]);
  if (missing.length) return { problem: "Answer all six questions. Unknown is a valid answer." };
  const income = parseDollarsToCents(draft.income);
  const assets = parseDollarsToCents(draft.assets);
  if (Number.isNaN(income) || Number.isNaN(assets)) return { problem: "Enter amounts in dollars and cents, for example 1,450.00." };
  const monthsText = draft.months.trim();
  if (monthsText && !/^\d{1,3}$/.test(monthsText)) return { problem: "Months of private pay is a whole number of months." };
  const months = monthsText ? Number(monthsText) : null;
  if (months != null && months > 240) return { problem: "Months of private pay can be at most 240." };
  const answers = draft.answers as Record<ScreeningQuestion, Knowledge>;
  return {
    payload: {
      resident_id: ids.residentId,
      admission_case_id: ids.admissionCaseId ?? null,
      source: ids.source,
      coverage: draft.coverage,
      coverage_plan: draft.coveragePlan.trim() || null,
      ...answers,
      monthly_income_cents: income,
      assets_cents: assets,
      private_pay_months: months,
      answered_by_kind: draft.answeredBy || null,
      notes: draft.notes.trim() || null,
    },
  };
}

export function resultTone(result: ScreeningResult): "muted" | "warning" | "info" {
  return result === "candidate" ? "info" : result === "needs_answers" ? "warning" : "muted";
}

function KnowledgeChoice({ name, value, onChange, legend }: { name: string; value: Knowledge | ""; onChange: (v: Knowledge) => void; legend: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {(["yes", "no", "unknown"] as const).map((option) => (
          <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-input px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted">
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            {option === "yes" ? "Yes" : option === "no" ? "No" : "Unknown"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The six New Admits Medicaid Pending Criteria questions plus coverage and amounts. Controlled; saves nothing on its own. */
export function MedicaidQuestionsFields({ draft, onChange, gate }: { draft: MedicaidQuestionsDraft; onChange: (next: MedicaidQuestionsDraft) => void; gate: AdmissionGate }) {
  const id = useId();
  const set = <K extends keyof MedicaidQuestionsDraft>(key: K, value: MedicaidQuestionsDraft[K]) => onChange({ ...draft, [key]: value });
  const preview = useMemo(() => {
    if (!draft.coverage || SCREENING_QUESTIONS.some((q) => !draft.answers[q])) return null;
    const income = parseDollarsToCents(draft.income);
    const assets = parseDollarsToCents(draft.assets);
    if (Number.isNaN(income) || Number.isNaN(assets)) return null;
    return classifyAdmissionScreening(draft.coverage, draft.answers as Record<ScreeningQuestion, Knowledge>, income, assets, gate);
  }, [draft, gate]);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-coverage`} required>Current coverage</FormLabel>
          <select id={`${id}-coverage`} className={fieldClass} value={draft.coverage} onChange={(e) => set("coverage", e.target.value as ScreeningCoverage | "")}>
            <option value="">Choose…</option>
            {SCREENING_COVERAGE.map((c) => <option key={c} value={c}>{COVERAGE_LABELS[c]}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">A Medicaid gold card is not long-term-care Medicaid; that resident may still be worth applying for.</p>
        </div>
        {(draft.coverage === "smmc_ltc_enrolled" || draft.coverage === "application_pending") && (
          <div className="space-y-2">
            <FormLabel htmlFor={`${id}-plan`}>Plan or reference</FormLabel>
            <input id={`${id}-plan`} className={fieldClass} value={draft.coveragePlan} onChange={(e) => set("coveragePlan", e.target.value)} placeholder="For example UHC" />
          </div>
        )}
      </div>
      <ol className="space-y-4">
        {SCREENING_QUESTIONS.map((q, index) => (
          <li key={q}>
            <KnowledgeChoice
              name={`${id}-${q}`}
              legend={`${String.fromCharCode(65 + index)}. ${screeningQuestionText(q, gate)}`}
              value={draft.answers[q]}
              onChange={(v) => onChange({ ...draft, answers: { ...draft.answers, [q]: v } })}
            />
          </li>
        ))}
      </ol>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-income`}>Monthly income ($)</FormLabel>
          <input id={`${id}-income`} className={fieldClass} inputMode="decimal" value={draft.income} onChange={(e) => set("income", e.target.value)} />
          <p className="text-xs text-muted-foreground">Leave blank when not known.</p>
        </div>
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-assets`}>Countable assets ($)</FormLabel>
          <input id={`${id}-assets`} className={fieldClass} inputMode="decimal" value={draft.assets} onChange={(e) => set("assets", e.target.value)} />
          <p className="text-xs text-muted-foreground">Needed when question E is yes.</p>
        </div>
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-months`}>Months they can private pay</FormLabel>
          <input id={`${id}-months`} className={fieldClass} inputMode="numeric" value={draft.months} onChange={(e) => set("months", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-by`}>Answered by</FormLabel>
          <select id={`${id}-by`} className={fieldClass} value={draft.answeredBy} onChange={(e) => set("answeredBy", e.target.value as MedicaidQuestionsDraft["answeredBy"])}>
            <option value="">Choose…</option>
            <option value="resident">Resident</option>
            <option value="poa">Power of attorney</option>
            <option value="family">Family member</option>
            <option value="staff_records">Staff, from records</option>
          </select>
        </div>
        <div className="space-y-2">
          <FormLabel htmlFor={`${id}-notes`}>Notes</FormLabel>
          <input id={`${id}-notes`} className={fieldClass} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      {preview && (
        <div className="rounded-[var(--radius)] border border-border p-3 text-sm" role="status">
          <p className="font-medium">If saved now: {RESULT_LABELS[preview.result]}</p>
          {preview.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">{preview.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Circle of Life screening policy, not an eligibility decision. Income limit {dollars(gate.income_limit_cents)} a month; asset limit {dollars(gate.assets_limit_cents)}.</p>
    </div>
  );
}

function effective(row: AdmissionScreeningRow): ScreeningResult {
  return row.override?.result ?? row.result;
}

function OverrideForm({ screening, onSaved }: { screening: AdmissionScreeningRow; onSaved: () => Promise<void> }) {
  const id = useId();
  const [result, setResult] = useState<"" | "candidate" | "not_qualified_now" | "needs_answers">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="grid gap-3 rounded-[var(--radius)] border border-border p-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setError(null);
        try {
          await benefitsFetch(`/api/admin/benefits/screenings/${screening.id}/override`, { method: "POST", body: JSON.stringify({ request_id: requestId, result, reason: reason.trim() }) });
          setRequestId(crypto.randomUUID()); setReason(""); setResult("");
          await onSaved();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to record the override.");
        } finally { setBusy(false); }
      }}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">Reviewers can replace the result of the latest answers, for example when income is held in a trust. The original answers and result stay on record.</p>
      <div className="space-y-2">
        <FormLabel htmlFor={`${id}-result`} required>Result</FormLabel>
        <select id={`${id}-result`} className={fieldClass} value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
          <option value="">Choose…</option>
          <option value="candidate">{RESULT_LABELS.candidate}</option>
          <option value="not_qualified_now">{RESULT_LABELS.not_qualified_now}</option>
          <option value="needs_answers">{RESULT_LABELS.needs_answers}</option>
        </select>
      </div>
      <div className="space-y-2">
        <FormLabel htmlFor={`${id}-reason`} required>Reason</FormLabel>
        <input id={`${id}-reason`} className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="sm:col-span-2"><ErrorNotice error={error} /></div>
      <div className="sm:col-span-2"><Button type="submit" className="min-h-11" disabled={busy || !result || !reason.trim()}>{busy ? "Recording…" : "Record override"}</Button></div>
    </form>
  );
}

/** Admission and resident view: latest result, history, new answers, reviewer override. */
export function AdmissionMedicaidScreening({ residentId, admissionCaseId, onSaved }: { residentId: string; admissionCaseId?: string | null; onSaved?: () => Promise<void> | void }) {
  const [data, setData] = useState<AdmissionScreeningList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MedicaidQuestionsDraft>(emptyMedicaidDraft);
  const [editing, setEditing] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await benefitsFetch<AdmissionScreeningList>(`/api/admin/benefits/screenings?resident_id=${encodeURIComponent(residentId)}`));
    } catch (caught) {
      setLoadError(caught instanceof BenefitsRequestError && (caught.status === 403 || caught.status === 404)
        ? "Medicaid answers are visible to staff with Medicaid access for this facility. Ask an owner to grant access under Medicaid & benefits → Access."
        : caught instanceof Error ? caught.message : "Unable to load the Medicaid questions.");
    }
  }, [residentId]);
  useEffect(() => { void load(); }, [load]);

  const latest = data?.screenings[0] ?? null;
  const save = async () => {
    if (!data) return;
    const built = medicaidDraftPayload(draft, { residentId, admissionCaseId, source: latest && data.open_recheck ? "recheck" : latest ? "manual" : "admission" });
    if ("problem" in built) { setError(built.problem); return; }
    setBusy(true); setError(null);
    try {
      await benefitsFetch<AdmissionScreeningReply>("/api/admin/benefits/screenings", { method: "POST", body: JSON.stringify({ request_id: requestId, screening: built.payload }) });
      setRequestId(crypto.randomUUID());
      setDraft(emptyMedicaidDraft());
      setEditing(false);
      await load();
      await onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the answers. Your answers are still here.");
    } finally { setBusy(false); }
  };

  return (
    <Panel title="Medicaid questions" description="The six New Admits Medicaid Pending Criteria questions. They decide whether Circle of Life should consider applying for long-term-care Medicaid now.">
      {loadError && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" className="min-h-11" onClick={() => void load()}>Try again</Button>
        </div>
      )}
      {!data && !loadError && <p role="status">Loading Medicaid questions…</p>}
      {data && (
        <>
          {latest ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone={resultTone(effective(latest))}>{RESULT_LABELS[effective(latest)]}</StatusPill>
                <span className="text-sm text-muted-foreground">
                  Answered {dateLabel(latest.answered_at)}{latest.recorded_by_name ? ` · recorded by ${latest.recorded_by_name}` : ""} · {COVERAGE_LABELS[latest.coverage]}
                </span>
              </div>
              {latest.override && <p className="text-sm">Result set by {latest.override.created_by_name ?? "a reviewer"}: {latest.override.reason} (answers said: {RESULT_LABELS[latest.result]})</p>}
              {latest.reasons.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{latest.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              {data.open_recheck && <p className="text-sm">Ask again on {dateLabel(data.open_recheck.due_on)}.</p>}
              {latest.runway_date && <p className="text-sm">Private pay expected to last until about {dateLabel(latest.runway_date)}.</p>}
              {data.active_case_id && (
                <Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href={`/admin/benefits/${data.active_case_id}`}>Open the Medicaid case</Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not asked yet.</p>
          )}
          {data.permissions.can_write && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" variant={latest ? "outline" : "default"} onClick={() => setEditing(true)}>{latest ? "Record new answers" : "Ask the Medicaid questions"}</Button>
              {data.permissions.can_review && latest && latest.result !== "already_enrolled" && (
                <Button className="min-h-11" variant="outline" onClick={() => setShowOverride((v) => !v)} aria-expanded={showOverride}>{showOverride ? "Cancel override" : "Override result"}</Button>
              )}
            </div>
          )}
          {showOverride && latest && <OverrideForm screening={latest} onSaved={async () => { setShowOverride(false); await load(); }} />}
          {editing && (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <MedicaidQuestionsFields draft={draft} onChange={setDraft} gate={data.gate} />
              <ErrorNotice error={error} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="min-h-11" disabled={busy}>{busy ? "Saving…" : "Save answers"}</Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
              </div>
            </form>
          )}
          {data.screenings.length > 1 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2">Earlier answers ({data.screenings.length - 1})</summary>
              <ul className="divide-y divide-border">
                {data.screenings.slice(1).map((row) => (
                  <li key={row.id} className="py-2">
                    {dateLabel(row.answered_at)} · {RESULT_LABELS[effective(row)]}{row.override ? " (override)" : ""}{row.recorded_by_name ? ` · ${row.recorded_by_name}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
