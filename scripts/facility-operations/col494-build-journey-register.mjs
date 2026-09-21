#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/operations/activity-catalog.json"), "utf8"));
const browserPath = path.join(ROOT, "docs/facility-operations/col494-evidence/browser-proof.json");
const browser = fs.existsSync(browserPath) ? JSON.parse(fs.readFileSync(browserPath, "utf8")) : { scenarios: {} };
const entries = catalog.entries.filter((entry) => /^AL-(D|W)/.test(entry.sourceId));
const unresolved = new Set(["AL-D01", "AL-D04", "AL-D08", "AL-D09", "AL-D10", "AL-D12", "AL-D15", "AL-D16", "AL-W02", "AL-W08"]);
const gapReasons = {
  "AL-D01": "The day's marketing-call scope, required outcomes and final source record remain Q28 decisions; the current human path does not equate one outreach row with the day's duty.",
  "AL-D04": "Payment context is not a bank deposit, scanned-copy finality or accounting acknowledgment. Q16/Q17 remain open.",
  "AL-D08": "The medication-platform reader/export and administrative review population are unresolved. Haven must not manufacture a dose or issue-free attestation.",
  "AL-D09": "The refused-medication source is unresolved; review and the resident/provider follow-up are separate components and neither infers contact or resolution.",
  "AL-D10": "The authoritative shift-report source and version are unresolved; a different resident log cannot be renamed as the shift report.",
  "AL-D12": "The meaning of '02' and the exact source log remain Q11/Q13 decisions. The synthetic proof demonstrates an oxygen-saturation source without adopting that interpretation for Homewood.",
  "AL-D15": "Attendance Calendar subject, system and counting rules are unresolved. No task subject, deadline or employment action is fabricated.",
  "AL-D16": "Destination, content reference and completion receipt remain Q28 decisions. Haven records a human statement; it does not publish social content.",
  "AL-W02": "AHCA roster integration is unavailable. Manual submission evidence cannot prove external acceptance; Q21 remains open.",
  "AL-W08": "Admission/discharge context is not a DCF sent/delivered acknowledgment. Recipient, channel and receipt remain Q21 decisions.",
};
const observed = {
  "hfo-al-d01-01": "routineRecovery, correction",
  "hfo-al-d03-01": "conditionalEvidence, helpAndCoverage",
  "hfo-al-w01-01": "generatorFailure, sourceVoid",
  "hfo-al-d17-01": "censusContext",
  "hfo-al-d12-01": "residentSourceReview",
  "hfo-al-w06-01": "employeeFileContext",
};
function panel(component) {
  if (component.key.startsWith("hfo-al-w01-")) return "Observation source record";
  if (["hfo-al-d04-01", "hfo-al-d17-01", "hfo-al-d19-01", "hfo-al-w08-01"].includes(component.key)) return "Finance and census source context";
  if (["hfo-al-d13-01", "hfo-al-d15-01", "hfo-al-w02-01", "hfo-al-w06-01", "hfo-al-w06-02"].includes(component.key)) return "Employee File source context";
  if (["resident", "employee"].includes(component.subjectKind) || component.kind === "record_review") return "Resident/employee source context plus manual review where eligible";
  return "Generic Site work recording path";
}
const rows = entries.map((entry) => ({
  source_id: entry.sourceId,
  sheet: entry.sourceSheet,
  cell: entry.sourceCell,
  source_text: entry.sourceText,
  disposition: unresolved.has(entry.sourceId) ? "explicit_unresolved_gap" : "supported_path",
  gap_reason: gapReasons[entry.sourceId] ?? null,
  questions: entry.questionIds,
  actual_homewood_configured: false,
  staff_accepted: false,
  paper_retired: false,
  components: entry.components.map((component) => ({
    activity_key: component.key,
    activity_id: component.id,
    label: component.label,
    kind: component.kind,
    subject_kind: component.subjectKind,
    staff_screen: component.subjectKind === null ? "/admin/operations/profile — needs confirmation; no task generated" : "/admin/operations/work",
    source_or_input_surface: panel(component),
    completion_action: component.subjectKind === null ? "Unavailable until subject/system is confirmed" : component.key.startsWith("hfo-al-w01-") ? "Record named-asset staff observation" : component.kind === "record_review" ? "Record explicit review; connected source supports but does not replace it" : "Record unscheduled work under synthetic unknown-schedule proof",
    evidence_behavior: component.key === "hfo-al-d03-01" ? "Synthetic photo rule proved performed-missing-evidence → finalized evidence → satisfied" : "Rule-controlled; no universal attachment or note",
    corporate_history: "/admin/operations/history — occurrence, immutable receipts, corrections and evidence under current authority",
    follow_up: "/admin/operations/attention and linked operation issue; a failed check remains open after source invalidation",
    browser_observed: Boolean(observed[component.key]),
    observed_scenarios: observed[component.key]?.split(", ") ?? [],
    synthetic_configured: component.subjectKind !== null,
    actual_homewood_configured: false,
    staff_accepted: false,
    paper_retired: false,
  })),
}));
if (rows.length !== 27 || rows.reduce((sum, row) => sum + row.components.length, 0) !== 35) throw new Error("Daily/Weekly register does not reconcile to 27 source rows and 35 components");
if (rows.filter((row) => row.disposition === "explicit_unresolved_gap").length !== 10) throw new Error("Daily/Weekly gap count changed");
const out = path.join(ROOT, "docs/facility-operations/col494-evidence");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "daily-weekly-journey-register.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), source_sha: browser.sourceSha ?? null, counts: { source_rows: 27, components: 35, supported_path: 17, explicit_unresolved_gap: 10, attributable_na: 0, browser_observed_components: rows.flatMap((row) => row.components).filter((component) => component.browser_observed).length, actual_homewood_configured: 0, staff_accepted: 0, paper_retired: 0 }, rows }, null, 2)}\n`);
const lines = [
  "# COL-494 Daily/Weekly journey register", "", `Generated against application revision \`${browser.sourceSha ?? "not yet run"}\`. Synthetic staging proof only; actual Homewood configured/staff-accepted/paper-retired remain 0/27.`, "",
  "| Source | Workbook duty | Disposition | Components | Staff and corporate path | Remaining boundary |", "|---|---|---|---:|---|---|",
  ...rows.map((row) => `| ${row.source_id} | ${row.source_text.replaceAll("|", "\\|")} | ${row.disposition} | ${row.components.length} | ${[...new Set(row.components.map((component) => component.source_or_input_surface))].join("; ")} → History / Needs Attention | ${row.gap_reason ?? "Homewood applicability, rule and acceptance remain separate."} |`),
  "", "## Evidence meanings", "", "- `supported_path` means the existing Haven journey is implemented or has an explicit manual recording path. It is not Homewood approval or staff acceptance.", "- `explicit_unresolved_gap` means the system preserves the duty and names the missing source definition/integration. It is not a missed check.", "- `browser_observed` is limited to the representative paths named in the JSON register. Unobserved rows are not silently promoted to UAT.", "- Corporate history and Needs Attention were observed with a separate authorized synthetic corporate actor. Cross-site denial was observed with a second-site actor.", "",
];
fs.writeFileSync(path.join(out, "daily-weekly-journey-register.md"), `${lines.join("\n")}\n`);
const questions = rows.filter((row) => row.gap_reason).map((row) => `| ${row.source_id} | ${row.source_text.replaceAll("|", "\\|")} | ${row.gap_reason} | ${row.questions.join(", ") || "None"} |`);
fs.writeFileSync(path.join(out, "homewood-wave-1-questions.md"), `# Homewood Wave 1 questions produced by COL-494\n\nThese ten bounded questions feed COL-226. They do not hold the synthetic engineering proof and do not approve a rule by being listed.\n\n| Source | Duty | Exact boundary to answer | Existing questions |\n|---|---|---|---|\n${questions.join("\n")}\n\nFor every answer retain the exact component IDs, facility/role scope, source or procedure version, evidence standard, exceptions, authorized approver and effective date. COL-140 applies only the answered scope.\n`);
console.log(JSON.stringify({ result: "PASS", rows: rows.length, components: rows.reduce((sum, row) => sum + row.components.length, 0), supported: rows.filter((row) => row.disposition === "supported_path").length, gaps: questions.length, observedComponents: rows.flatMap((row) => row.components).filter((component) => component.browser_observed).length }));
