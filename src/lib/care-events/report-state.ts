/**
 * "Something happened" three-tap flow state (spec 07A §2, §6.4).
 * Pure reducer plus selectors. No IO. The orchestrator component owns the
 * Supabase reads and dispatches here.
 */

import { type CareEventAnswers, type CareEventKind, isCareEventKind } from "./level-engine";
import { careEventTileByKind } from "./tiles";
import type { CareEventReceipt } from "./submit";

export type ReportStep = "who" | "what" | "how_bad" | "receipt";

export type ReportResident = {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  roomLabel: string;
};

export type ReportSubmitStatus = "idle" | "submitting" | "sent" | "queued" | "failed";

export type ReportState = {
  clientEventId: string;
  step: ReportStep;
  /** True once the Who step was answered (a resident or "the building"). */
  whoAnswered: boolean;
  resident: ReportResident | null;
  kind: CareEventKind | null;
  answers: Record<string, string | string[]>;
  worried: boolean;
  locationCode: string | null;
  locationLabel: string | null;
  earlierOpen: boolean;
  /** Minutes before now, 0 to 480 in steps of 15. */
  minutesAgo: number;
  submitStatus: ReportSubmitStatus;
  submitError: string | null;
  receipt: CareEventReceipt | null;
  /** Wall-clock the flow was sent (or queued), for the receipt saved line. */
  sentAtIso: string | null;
};

export const EARLIER_STEP_MINUTES = 15;
export const EARLIER_MAX_MINUTES = 480;

export type ReportAction =
  | { type: "prefill"; resident: ReportResident | null; kind: CareEventKind | null }
  | { type: "pick_resident"; resident: ReportResident }
  | { type: "no_resident" }
  | { type: "pick_kind"; kind: CareEventKind }
  | { type: "set_answer"; key: string; value: string }
  | { type: "toggle_answer"; key: string; value: string }
  | { type: "toggle_worried" }
  | { type: "set_location"; code: string | null; label: string | null }
  | { type: "toggle_earlier" }
  | { type: "step_minutes"; delta: number }
  | { type: "back" }
  | { type: "submit_start"; sentAtIso: string }
  | { type: "submit_success"; receipt: CareEventReceipt }
  | { type: "submit_failure"; error: string }
  | { type: "offline_queued"; sentAtIso: string }
  | { type: "queue_confirmed"; receipt: CareEventReceipt };

export function initialReportState(clientEventId: string): ReportState {
  return {
    clientEventId,
    step: "who",
    whoAnswered: false,
    resident: null,
    kind: null,
    answers: {},
    worried: false,
    locationCode: null,
    locationLabel: null,
    earlierOpen: false,
    minutesAgo: 0,
    submitStatus: "idle",
    submitError: null,
    receipt: null,
    sentAtIso: null,
  };
}

function clampMinutes(value: number): number {
  const stepped = Math.round(value / EARLIER_STEP_MINUTES) * EARLIER_STEP_MINUTES;
  return Math.min(EARLIER_MAX_MINUTES, Math.max(0, stepped));
}

function stepAfterWho(state: ReportState): ReportStep {
  return state.kind ? "how_bad" : "what";
}

function resetAnswers(state: ReportState): ReportState {
  return { ...state, answers: {}, worried: false };
}

export function reportReducer(state: ReportState, action: ReportAction): ReportState {
  switch (action.type) {
    case "prefill": {
      let next: ReportState = { ...state };
      if (action.kind && isCareEventKind(action.kind)) next.kind = action.kind;
      if (action.resident) {
        next = { ...next, resident: action.resident, whoAnswered: true };
      }
      if (next.whoAnswered) {
        next.step = stepAfterWho(next);
      } else {
        next.step = "who";
      }
      return next;
    }
    case "pick_resident": {
      const next = resetAnswers({ ...state, resident: action.resident, whoAnswered: true });
      return { ...next, step: stepAfterWho(next) };
    }
    case "no_resident": {
      const keepKind = state.kind ? careEventTileByKind(state.kind).residentOptional : false;
      const next = resetAnswers({
        ...state,
        resident: null,
        whoAnswered: true,
        kind: keepKind ? state.kind : null,
      });
      return { ...next, step: stepAfterWho(next) };
    }
    case "pick_kind": {
      if (!state.resident && !careEventTileByKind(action.kind).residentOptional) return state;
      const next = resetAnswers({ ...state, kind: action.kind });
      return { ...next, step: "how_bad" };
    }
    case "set_answer":
      return { ...state, answers: { ...state.answers, [action.key]: action.value } };
    case "toggle_answer": {
      const current = state.answers[action.key];
      const list = Array.isArray(current) ? current : [];
      const nextList = list.includes(action.value)
        ? list.filter((value) => value !== action.value)
        : [...list, action.value];
      return { ...state, answers: { ...state.answers, [action.key]: nextList } };
    }
    case "toggle_worried":
      return { ...state, worried: !state.worried };
    case "set_location":
      return { ...state, locationCode: action.code, locationLabel: action.label };
    case "toggle_earlier": {
      if (state.earlierOpen) return { ...state, earlierOpen: false, minutesAgo: 0 };
      return { ...state, earlierOpen: true, minutesAgo: EARLIER_STEP_MINUTES };
    }
    case "step_minutes":
      return { ...state, minutesAgo: clampMinutes(state.minutesAgo + action.delta) };
    case "back": {
      if (state.step === "how_bad") return { ...state, step: "what" };
      if (state.step === "what") return { ...state, step: "who" };
      return state;
    }
    case "submit_start":
      return { ...state, submitStatus: "submitting", submitError: null, sentAtIso: action.sentAtIso };
    case "submit_success":
      return { ...state, submitStatus: "sent", submitError: null, receipt: action.receipt, step: "receipt" };
    case "submit_failure":
      return { ...state, submitStatus: "failed", submitError: action.error };
    case "offline_queued":
      return {
        ...state,
        submitStatus: "queued",
        submitError: null,
        receipt: null,
        sentAtIso: action.sentAtIso,
        step: "receipt",
      };
    case "queue_confirmed":
      return { ...state, submitStatus: "sent", receipt: action.receipt, step: "receipt" };
    default:
      return state;
  }
}

/** Every single-select question on the tile has an answer. Multi-select rows may be empty. */
export function canSend(state: ReportState): boolean {
  if (!state.kind) return false;
  if (state.submitStatus === "submitting") return false;
  if (!state.resident && !careEventTileByKind(state.kind).residentOptional) return false;
  const tile = careEventTileByKind(state.kind);
  return tile.questions.every((question) => {
    if (question.multi) return true;
    const value = state.answers[question.key];
    return typeof value === "string" && value.length > 0;
  });
}

/** Answers in the engine's flat shape with the reporter bump merged in. */
export function answersForEngine(state: ReportState): CareEventAnswers & { worried: boolean } {
  const answers: Record<string, string | string[] | boolean> = {};
  for (const [key, value] of Object.entries(state.answers)) {
    if (Array.isArray(value) ? value.length > 0 : value.length > 0) answers[key] = value;
  }
  answers.worried = state.worried;
  return answers as CareEventAnswers & { worried: boolean };
}

/** Now minus the stepper minutes, as an ISO instant. */
export function occurredAtIso(state: ReportState, now: Date = new Date()): string {
  return new Date(now.getTime() - state.minutesAgo * 60_000).toISOString();
}

/** "Just now", "15 minutes ago", "1 hour ago", "1 hour 15 minutes ago". */
export function formatMinutesAgo(minutes: number): string {
  if (minutes <= 0) return "Just now";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (rest > 0) parts.push(`${rest} minutes`);
  return `${parts.join(" ")} ago`;
}
