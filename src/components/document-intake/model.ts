/**
 * Document Intake review UI — display rules (COL-771, DI-03).
 *
 * Pure functions only: the workspace list, the review page and their tests
 * read the same wording from here. Spec: docs/specs/41-document-intake.md.
 */
import {
  INTAKE_TABS,
  ITEM_STATUS_LABELS,
  PROCESSING_STATE_LABELS,
  type IntakeItem,
  type IntakeTab,
  type ItemStatus,
  type ProcessingState,
  type StageStatus,
} from "@/lib/document-intake/contracts";
import { enumLabel } from "@/lib/display/enum-label";
import type { StatusPillTone } from "@/components/ui/status-pill";

export const INTAKE_TAB_ORDER: IntakeTab[] = ["pending", "processing", "attention", "filed", "all"];

export function parseIntakeTab(value: string | null | undefined): IntakeTab {
  return INTAKE_TAB_ORDER.includes(value as IntakeTab) ? (value as IntakeTab) : "pending";
}

export function tabStatuses(tab: IntakeTab): readonly ItemStatus[] {
  return INTAKE_TABS[tab].statuses;
}

/** Statuses a person still has to act on: these age and can be overdue. */
export const OPEN_STATUSES: readonly ItemStatus[] = ["receiving", "queued", "processing", "pending_review", "held", "needs_attention"];

/** Statuses a reviewer can file from (mirrors document_intake_prepare_filing). */
export const REVIEWABLE_STATUSES: readonly ItemStatus[] = ["pending_review", "held", "needs_attention"];

export function statusLabel(status: ItemStatus): string {
  return ITEM_STATUS_LABELS[status] ?? enumLabel(status);
}

export function statusTone(status: ItemStatus): StatusPillTone {
  switch (status) {
    case "pending_review":
      return "info";
    case "held":
    case "needs_attention":
      return "warning";
    case "filed":
      return "success";
    default:
      return "muted";
  }
}

export function processingLabel(state: ProcessingState): string {
  return PROCESSING_STATE_LABELS[state] ?? enumLabel(state);
}

export function processingTone(state: ProcessingState): StatusPillTone {
  if (state === "failed" || state === "uncertain") return "danger";
  if (state === "blocked") return "warning";
  return "muted";
}

export const CHANNEL_LABELS: Record<IntakeItem["channel"], string> = {
  upload: "Upload",
  email: "Email",
  split: "Split",
};

export function itemTitle(item: Pick<IntakeItem, "display_title" | "original_filename">): string {
  return item.display_title?.trim() || item.original_filename;
}

const HOUR_MS = 3_600_000;

/** Waiting time in words: "35 min", "5 h", "3 d". */
export function ageLabel(receivedAt: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(receivedAt));
  if (!Number.isFinite(ms)) return "—";
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / (24 * HOUR_MS))} d`;
}

/** Overdue = still open and waiting longer than the organization's pending_alert_hours. */
export function isOverdue(item: Pick<IntakeItem, "status" | "received_at">, alertHours: number | null, now: number = Date.now()): boolean {
  if (alertHours == null || !OPEN_STATUSES.includes(item.status)) return false;
  const received = Date.parse(item.received_at);
  return Number.isFinite(received) && now - received > alertHours * HOUR_MS;
}

/** [1,2,3,5] → "pages 1–3, 5"; [4] → "page 4". */
export function pagesLabel(pages: readonly number[] | null | undefined): string | null {
  const sorted = [...new Set((pages ?? []).filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const page of [...sorted.slice(1), Number.NaN]) {
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = page;
    prev = page;
  }
  return `${sorted.length === 1 ? "page" : "pages"} ${ranges.join(", ")}`;
}

// ── Assessment wording: honest about what did not run ──────────────────────

export type StageName = "reader" | "jev";

const STAGE_NOUN: Record<StageName, string> = { reader: "AI", jev: "Jev" };

/**
 * One line per stage. A stage that did not run never reads as a pass: it says
 * "not run" and why. When there is no proposal at all, the item's processing
 * state is the only evidence.
 */
export function stageStatusLabel(stage: StageName, status: StageStatus | undefined, processingState?: ProcessingState): string {
  const noun = STAGE_NOUN[stage];
  if (!status) {
    if (processingState === "uncertain") return `${noun} result unknown`;
    if (processingState === "failed") return `${noun} failed`;
    if (processingState === "blocked") return `${noun} not run`;
    if (processingState === "queued" || processingState === "running" || processingState === "not_started") return `${noun} not run yet`;
    return `${noun} not run`;
  }
  switch (status.state) {
    case "ran":
      return stage === "reader" ? "AI read this document" : "Jev answered";
    case "not_authorized":
      return `${noun} not run — not authorized`;
    case "not_configured":
      return `${noun} not run — not set up`;
    case "failed":
      return `${noun} failed`;
    case "not_applicable":
      return `${noun} not used for this type`;
    case "skipped":
      return `${noun} not run — skipped`;
  }
}

export function stageTone(status: StageStatus | undefined, processingState?: ProcessingState): StatusPillTone {
  if (!status) return processingState === "uncertain" || processingState === "failed" ? "danger" : "muted";
  if (status.state === "ran") return "info";
  if (status.state === "failed") return "danger";
  return "muted";
}

type JevAnswerLike = {
  type?: string;
  choice?: string;
  noul?: number;
  score?: number;
  probabilities?: Record<string, number>;
};

/** "0.82" — always two decimals, never a percent. */
export function formatProbability(value: number): string {
  return value.toFixed(2);
}

/**
 * A Jev answer as a reviewer reads it: the chosen option and the provider's
 * probability for it ("probability 0.82"). Never "percent correct" and never
 * "confidence" — the number is Jev's, not an accuracy claim.
 */
export function jevAnswerLine(answer: JevAnswerLike): { chosen: string; probability: string | null } {
  if (answer.type === "choice" && answer.choice) {
    const p = answer.probabilities?.[answer.choice];
    return { chosen: enumLabel(answer.choice), probability: typeof p === "number" ? `probability ${formatProbability(p)}` : null };
  }
  if (answer.type === "noul" && typeof answer.noul === "number") {
    return { chosen: answer.noul >= 0.5 ? "Yes" : "No", probability: `probability of yes ${formatProbability(answer.noul)}` };
  }
  if (answer.type === "score" && typeof answer.score === "number") {
    return { chosen: `Score ${formatProbability(answer.score)}`, probability: null };
  }
  return { chosen: "No answer", probability: null };
}

export const CHECK_RESULT_LABELS = { pass: "Pass", fail: "Fail", unknown: "Unknown" } as const;
export const CHECK_RESULT_TONES: Record<keyof typeof CHECK_RESULT_LABELS, StatusPillTone> = { pass: "success", fail: "danger", unknown: "muted" };

// ── History ────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  upload_prepared: "Upload started",
  source_verified: "Original checked",
  received: "Received",
  claim: "Opened for review",
  release: "Closed review",
  assign: "Assigned",
  hold: "Put on hold",
  resume: "Taken off hold",
  exclude: "Excluded",
  mark_duplicate: "Marked as a duplicate",
  set_facility: "Facility set",
  set_title: "Title changed",
  reprocess: "Sent to be read again",
  split_prepared: "Split started",
  split: "Split into parts",
  filing_prepared: "Filing started",
  filed: "Filed",
  filing_abandoned: "Filing cancelled",
  filing_corrected: "Filing corrected",
  proposal_ready: "Suggestion ready",
  processing_uncertain: "AI result unknown",
  processing_failed: "AI failed",
  processing_blocked: "AI not run",
};

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? enumLabel(event);
}

export function principalLabel(principal: string, personName: string | null): string {
  switch (principal) {
    case "person":
      return personName ?? "A staff member";
    case "worker":
      return "Haven reader";
    case "mail_receiver":
      return "Email receipt";
    default:
      return "Haven";
  }
}

export const DESTINATION_KIND_LABELS = {
  resident_document: "Resident record",
  benefits_document: "Medicaid case",
  employee_file: "Staff file",
  facility_document: "Facility documents",
} as const;
