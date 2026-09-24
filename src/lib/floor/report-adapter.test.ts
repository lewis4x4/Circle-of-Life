import { describe, expect, it } from "vitest";

import { initialReportState, reportReducer, type ReportResident, type ReportState } from "@/lib/care-events/report-state";

import { answerSummary, floorReportView, previousQuestionIndex, questionCounterLabel, reportProgressPercent } from "./report-adapter";

const harold: ReportResident = { id: "r-102", displayName: "Harold Nguyen", firstName: "Harold", lastName: "Nguyen", roomLabel: "102" };

function fallStarted(): ReportState {
  let state = initialReportState("client-1");
  state = reportReducer(state, { type: "pick_resident", resident: harold });
  return reportReducer(state, { type: "pick_kind", kind: "fall" });
}

describe("floor report adapter", () => {
  it("shows who and what on one screen until a tile is picked", () => {
    const initial = initialReportState("client-1");
    expect(floorReportView(initial, 0)).toEqual({ screen: "pick" });
    const picked = reportReducer(initial, { type: "pick_resident", resident: harold });
    expect(floorReportView(picked, 0)).toEqual({ screen: "pick" });
  });

  it("walks the tile's questions one per screen, then the send screen", () => {
    const state = fallStarted();
    const first = floorReportView(state, 0);
    expect(first).toMatchObject({ screen: "question", index: 0, total: 4 });
    expect(first.screen === "question" && first.question.prompt).toBe("Are they hurt?");
    expect(questionCounterLabel(first)).toBe("Question 1 of 4");
    expect(reportProgressPercent(first)).toBe(0);

    const third = floorReportView(state, 2);
    expect(questionCounterLabel(third)).toBe("Question 3 of 4");
    expect(reportProgressPercent(third)).toBe(50);

    expect(floorReportView(state, 4)).toEqual({ screen: "send", total: 4 });
  });

  it("goes back a question, and from the first back to the pick screen", () => {
    expect(previousQuestionIndex(2)).toBe(1);
    expect(previousQuestionIndex(0)).toBe("pick");
  });

  it("summarizes the answers with the tiles' own labels", () => {
    let state = fallStarted();
    state = reportReducer(state, { type: "set_answer", key: "hurt", value: "not_hurt" });
    state = reportReducer(state, { type: "set_answer", key: "head", value: "no" });
    state = reportReducer(state, { type: "set_answer", key: "witnessed", value: "yes" });
    state = reportReducer(state, { type: "set_answer", key: "going_out", value: "no" });
    expect(answerSummary(state)).toEqual([
      { prompt: "Are they hurt?", answer: "Not hurt" },
      { prompt: "Did they hit their head?", answer: "No" },
      { prompt: "Did anyone see it happen?", answer: "Yes" },
      { prompt: "Are they going out (911 called or going to the ER)?", answer: "No" },
    ]);
  });

  it("joins a multi-answer question and says None when it was left empty", () => {
    let state = initialReportState("client-2");
    state = reportReducer(state, { type: "pick_resident", resident: harold });
    state = reportReducer(state, { type: "pick_kind", kind: "injury_found" });
    state = reportReducer(state, { type: "toggle_answer", key: "seen", value: "bruise" });
    state = reportReducer(state, { type: "toggle_answer", key: "seen", value: "burn" });
    const summary = answerSummary(state);
    expect(summary[0]).toEqual({ prompt: "What do you see?", answer: "Bruise, Burn" });
    expect(summary[1]).toEqual({ prompt: "How bad?", answer: "None" });
  });

  it("shows the receipt once sent", () => {
    let state = fallStarted();
    state = reportReducer(state, { type: "offline_queued", sentAtIso: "2026-09-23T13:40:00Z" });
    const view = floorReportView(state, 4);
    expect(view).toEqual({ screen: "sent", total: 4 });
    expect(questionCounterLabel(view)).toBe("Sent");
    expect(reportProgressPercent(view)).toBe(100);
  });
});
