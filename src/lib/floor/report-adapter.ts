/**
 * The "Something happened" flow in the floor tablet's layout (spec 40 §6
 * screen 6, DESIGN.md 06 to 07b). Same reducer, tiles, level engine and send
 * path as `/caregiver/report`; this only decides which screen shows: who and
 * what on one screen, then one question per screen, then the send screen with
 * the level read-back, then the receipt.
 */

import type { ReportState } from "@/lib/care-events/report-state";
import { careEventTileByKind, type CareEventQuestion } from "@/lib/care-events/tiles";

export type FloorReportView =
  | { screen: "pick" }
  | { screen: "question"; index: number; total: number; question: CareEventQuestion }
  | { screen: "send"; total: number }
  | { screen: "sent"; total: number };

/**
 * `questionIndex` is the floor layout's own cursor; the reducer's step says
 * whether the flow is before, inside or after the questions.
 */
export function floorReportView(state: ReportState, questionIndex: number): FloorReportView {
  if (state.step === "who" || state.step === "what" || !state.kind) return { screen: "pick" };
  const questions = careEventTileByKind(state.kind).questions;
  if (state.step === "receipt") return { screen: "sent", total: questions.length };
  if (questionIndex < questions.length) {
    const index = Math.max(0, questionIndex);
    return { screen: "question", index, total: questions.length, question: questions[index] };
  }
  return { screen: "send", total: questions.length };
}

/** "Question 1 of 4". */
export function questionCounterLabel(view: FloorReportView): string {
  if (view.screen === "question") return `Question ${view.index + 1} of ${view.total}`;
  if (view.screen === "sent") return "Sent";
  if (view.screen === "send") return "Ready to send";
  return "";
}

/** Width of the progress bar under the header, 0 to 100. */
export function reportProgressPercent(view: FloorReportView): number {
  if (view.screen === "question") return Math.round((view.index / view.total) * 100);
  if (view.screen === "send" || view.screen === "sent") return 100;
  return 0;
}

/** A single-answer question advances on the tap; a multi-answer one waits for Next. */
export function advancesOnTap(question: CareEventQuestion): boolean {
  return !question.multi;
}

export type AnswerLine = { prompt: string; answer: string };

/** The receipt's summary card: every question with the answer given, in order. */
export function answerSummary(state: ReportState): AnswerLine[] {
  if (!state.kind) return [];
  return careEventTileByKind(state.kind).questions.map((question) => {
    const value = state.answers[question.key];
    const values = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    const labels = values
      .map((code) => question.options.find((option) => option.value === code)?.label ?? null)
      .filter((label): label is string => Boolean(label));
    return { prompt: question.prompt, answer: labels.length > 0 ? labels.join(", ") : "None" };
  });
}

/** Where Back goes from a question: the previous question, or the pick screen from the first. */
export function previousQuestionIndex(index: number): number | "pick" {
  return index <= 0 ? "pick" : index - 1;
}
