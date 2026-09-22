"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import {
  BENEFITS_STAGES,
  type BenefitsRuleEntry,
  type BenefitsRuleKey,
  type BenefitsRulesList,
} from "@/lib/benefits/contracts";
import { benefitsFetch, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

const RULE_LABELS: Record<BenefitsRuleKey, { title: string; help: string }> = {
  "checklist.smmc_ltc": { title: "Checklist: Medicaid long-term care", help: "Requirements seeded on every new long-term care case. One per line: Title | stage | signature (pending or not_required)." },
  "checklist.oss": { title: "Checklist: Optional State Supplementation", help: "Requirements seeded on every new OSS case. One per line: Title | stage | signature." },
  "checklist.other": { title: "Checklist: other benefits", help: "Requirements seeded on every new case for other programs. One per line: Title | stage | signature." },
  "screening.standard_individual": { title: "Financial screening standard (individual)", help: "Review-aid limits only; never an eligibility decision. Enter dollars; stored in cents." },
  "family_collection.max_days": { title: "Family upload window (days)", help: "How long a family document request stays open before it expires." },
  "renewal.warning_days": { title: "Renewal warning (days)", help: "The queue flags a case this many days before its recorded renewal date." },
};
const stageSet = new Set<string>(BENEFITS_STAGES);

export function parseChecklist(text: string) {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = "", stage = "", signature = "not_required"] = line.split("|").map((part) => part.trim());
      return { title, stage, signature_status: signature || "not_required" };
    });
  for (const item of items) {
    if (!item.title) throw new Error("Every checklist line needs a title.");
    if (!stageSet.has(item.stage)) throw new Error(`"${item.title}" needs a stage: ${BENEFITS_STAGES.join(", ")}.`);
    if (!["pending", "not_required"].includes(item.signature_status)) throw new Error(`"${item.title}" signature must be pending or not_required.`);
  }
  return items;
}
export function checklistText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => `${item.title} | ${item.stage} | ${item.signature_status ?? "not_required"}`).join("\n")
    : "";
}
const dollars = (cents: unknown) => (typeof cents === "number" ? (cents / 100).toFixed(2) : "");
export function describeRule(entry: BenefitsRuleEntry) {
  const value = entry.value as Record<string, unknown> | number | unknown[] | null;
  if (entry.rule_key.startsWith("checklist.")) return `${Array.isArray(value) ? value.length : 0} requirement${Array.isArray(value) && value.length === 1 ? "" : "s"}`;
  if (entry.rule_key === "screening.standard_individual") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Not recorded";
    return `Income $${dollars(value.income_cents)} · Assets $${dollars(value.assets_cents)} · ${String(value.label ?? "")}`;
  }
  return typeof value === "number" ? `${value} days` : "Not recorded";
}

function RuleEditor({ entry, onSaved }: { entry: BenefitsRuleEntry; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [text, setText] = useState(() => checklistText(entry.value));
  const current = (entry.value ?? {}) as Record<string, unknown>;
  const [income, setIncome] = useState(() => dollars(current.income_cents));
  const [assets, setAssets] = useState(() => dollars(current.assets_cents));
  const [labelText, setLabelText] = useState(() => (typeof current.label === "string" ? current.label : ""));
  const [source, setSource] = useState(() => (typeof current.source === "string" ? current.source : ""));
  const [days, setDays] = useState(() => (typeof entry.value === "number" ? String(entry.value) : ""));
  const meta = RULE_LABELS[entry.rule_key];
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let value: unknown;
      if (entry.rule_key.startsWith("checklist.")) value = parseChecklist(text);
      else if (entry.rule_key === "screening.standard_individual") {
        const toCents = (s: string) => Math.round(Number(s) * 100);
        if (!Number.isFinite(toCents(income)) || !Number.isFinite(toCents(assets)) || toCents(income) <= 0 || toCents(assets) <= 0) throw new Error("Enter positive dollar amounts for income and assets.");
        value = { income_cents: toCents(income), assets_cents: toCents(assets), label: labelText.trim(), ...(source.trim() ? { source: source.trim() } : {}) };
      } else {
        if (!/^\d+$/.test(days)) throw new Error("Enter a whole number of days.");
        value = Number(days);
      }
      await benefitsFetch("/api/admin/benefits/rules", { method: "POST", body: JSON.stringify({ rule_key: entry.rule_key, value, effective_from: effectiveFrom, reason: reason.trim() }) });
      setOpen(false);
      setReason("");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the rule.");
    } finally {
      setBusy(false);
    }
  };
  const id = `rule-${entry.rule_key.replace(/\./g, "-")}`;
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{meta.title}</p>
          <p className="text-sm">{describeRule(entry)}</p>
          <p className="text-xs text-muted-foreground">
            {entry.current ? `In force since ${entry.current.effective_from} · ${entry.current.reason}` : "Built-in default; no organization rule recorded"}
            {entry.scheduled.length > 0 && ` · ${entry.scheduled.length} scheduled change${entry.scheduled.length === 1 ? "" : "s"} (next ${entry.scheduled[0].effective_from})`}
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Cancel" : "Change"}
        </Button>
      </div>
      {open && (
        <form
          className="grid gap-3 rounded-[var(--radius)] border border-border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm text-muted-foreground sm:col-span-2">{meta.help}</p>
          {entry.rule_key.startsWith("checklist.") && (
            <div className="space-y-2 sm:col-span-2">
              <FormLabel htmlFor={`${id}-items`} required>Checklist items</FormLabel>
              <textarea id={`${id}-items`} className={`${fieldClass} min-h-40 font-mono`} value={text} onChange={(event) => setText(event.target.value)} />
            </div>
          )}
          {entry.rule_key === "screening.standard_individual" && (
            <>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-income`} required>Monthly income limit ($)</FormLabel><input id={`${id}-income`} className={fieldClass} inputMode="decimal" value={income} onChange={(event) => setIncome(event.target.value)} /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-assets`} required>Asset limit ($)</FormLabel><input id={`${id}-assets`} className={fieldClass} inputMode="decimal" value={assets} onChange={(event) => setAssets(event.target.value)} /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-label`} required>Standard name</FormLabel><input id={`${id}-label`} className={fieldClass} value={labelText} onChange={(event) => setLabelText(event.target.value)} /></div>
              <div className="space-y-2"><FormLabel htmlFor={`${id}-source`}>Source link</FormLabel><input id={`${id}-source`} className={fieldClass} value={source} onChange={(event) => setSource(event.target.value)} /></div>
            </>
          )}
          {(entry.rule_key === "family_collection.max_days" || entry.rule_key === "renewal.warning_days") && (
            <div className="space-y-2"><FormLabel htmlFor={`${id}-days`} required>Days</FormLabel><input id={`${id}-days`} className={fieldClass} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} /></div>
          )}
          <div className="space-y-2"><FormLabel htmlFor={`${id}-from`} required>Takes effect on</FormLabel><input id={`${id}-from`} type="date" className={fieldClass} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div>
          <div className="space-y-2 sm:col-span-2"><FormLabel htmlFor={`${id}-reason`} required>Reason and source</FormLabel><input id={`${id}-reason`} className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. DCF Appendix A-9 for 2027, published 2026-12" /></div>
          <div className="sm:col-span-2"><ErrorNotice error={error} /></div>
          <div className="sm:col-span-2"><Button type="submit" className="min-h-11" disabled={busy || !effectiveFrom || !reason.trim()}>{busy ? "Recording…" : "Record rule"}</Button></div>
        </form>
      )}
    </li>
  );
}

export function BenefitsRules() {
  const [data, setData] = useState<BenefitsRulesList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await benefitsFetch<BenefitsRulesList>("/api/admin/benefits/rules"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load operating rules.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Panel
      title="Operating rules"
      description="Checklists, the financial screening standard and time windows are recorded here with the date they take effect and why. Changes never rewrite the past; cases already open keep the requirements they were created with."
    >
      <ErrorNotice error={error} />
      {!data && !error && <p role="status">Loading operating rules…</p>}
      {data && (
        <ul className="divide-y divide-border">
          {data.rules.map((entry) =>
            data.can_manage ? (
              <RuleEditor key={entry.rule_key} entry={entry} onSaved={load} />
            ) : (
              <li key={entry.rule_key} className="py-4">
                <p className="font-medium">{RULE_LABELS[entry.rule_key].title}</p>
                <p className="text-sm">{describeRule(entry)}</p>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}
