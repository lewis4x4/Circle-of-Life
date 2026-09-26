import { describe, expect, it } from "vitest";

import { INTAKE_TABS, ITEM_STATUSES, type ProposalRow } from "@/lib/document-intake/contracts";

import {
  ageLabel,
  eventLabel,
  flaggedJevChecks,
  isOverdue,
  jevAnswerLine,
  pagesLabel,
  parseIntakeTab,
  principalLabel,
  stageStatusLabel,
  statusTone,
  tabStatuses,
  verdictsComplete,
  verdictsForFiling,
} from "./model";

describe("intake tabs", () => {
  it("defaults to Pending review and ignores unknown tabs", () => {
    expect(parseIntakeTab(undefined)).toBe("pending");
    expect(parseIntakeTab("nonsense")).toBe("pending");
    expect(parseIntakeTab("filed")).toBe("filed");
  });

  it("maps each tab to its statuses and every status appears in a work tab or Filed/All", () => {
    expect(tabStatuses("pending")).toEqual(["pending_review", "held"]);
    expect(tabStatuses("attention")).toEqual(["needs_attention"]);
    expect([...tabStatuses("all")].sort()).toEqual([...ITEM_STATUSES].sort());
    expect(INTAKE_TABS.processing.statuses).toContain("queued");
  });

  it("gives held and needs-attention a warning tone and filed a success tone", () => {
    expect(statusTone("held")).toBe("warning");
    expect(statusTone("needs_attention")).toBe("warning");
    expect(statusTone("filed")).toBe("success");
    expect(statusTone("excluded")).toBe("muted");
  });
});

describe("page references", () => {
  it("collapses runs into ranges", () => {
    expect(pagesLabel([1, 2])).toBe("pages 1–2");
    expect(pagesLabel([5, 1, 2, 3])).toBe("pages 1–3, 5");
    expect(pagesLabel([4])).toBe("page 4");
    expect(pagesLabel([])).toBeNull();
    expect(pagesLabel(null)).toBeNull();
  });
});

describe("age and overdue", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("reads minutes, hours, then days", () => {
    expect(ageLabel("2026-09-25T11:50:00Z", now)).toBe("10 min");
    expect(ageLabel("2026-09-25T07:00:00Z", now)).toBe("5 h");
    expect(ageLabel("2026-09-22T12:00:00Z", now)).toBe("3 d");
  });

  it("is overdue only while open and past the alert hours", () => {
    const old = "2026-09-24T10:00:00Z";
    expect(isOverdue({ status: "pending_review", received_at: old }, 24, now)).toBe(true);
    expect(isOverdue({ status: "pending_review", received_at: old }, 48, now)).toBe(false);
    expect(isOverdue({ status: "filed", received_at: old }, 24, now)).toBe(false);
    expect(isOverdue({ status: "pending_review", received_at: old }, null, now)).toBe(false);
  });
});

describe("honest AI stage wording", () => {
  it("never reads a stage that did not run as a pass", () => {
    expect(stageStatusLabel("reader", { state: "not_authorized" })).toBe("AI not run: not authorized");
    expect(stageStatusLabel("reader", { state: "failed" })).toBe("AI failed");
    expect(stageStatusLabel("jev", { state: "not_applicable" })).toBe("Jev not used for this type");
    expect(stageStatusLabel("reader", undefined, "uncertain")).toBe("AI result unknown");
    expect(stageStatusLabel("reader", undefined, "blocked")).toBe("AI not run");
    expect(stageStatusLabel("reader", { state: "ran" })).toBe("AI read this document");
  });

  it("shows a Jev probability as 'probability 0.82', never a percent or confidence", () => {
    const line = jevAnswerLine({ type: "choice", choice: "form_1823", probabilities: { form_1823: 0.8234, other: 0.1766 } });
    expect(line.chosen).toBe("Form 1823");
    expect(line.probability).toBe("probability 0.82");
    const all = `${line.chosen} ${line.probability}`;
    expect(all).not.toMatch(/%|confiden|correct|accura/i);
    expect(jevAnswerLine({ type: "noul", noul: 0.31 }).probability).toBe("probability of yes 0.31");
  });
});

describe("history wording", () => {
  it("names events in plain words and falls back to the enum label", () => {
    expect(eventLabel("filing_corrected")).toBe("Filing corrected");
    expect(eventLabel("processing_uncertain")).toBe("AI result unknown");
    expect(eventLabel("some_new_event")).toBe("Some new event");
  });

  it("names who acted", () => {
    expect(principalLabel("person", "Dana Reviewer")).toBe("Dana Reviewer");
    expect(principalLabel("person", null)).toBe("A staff member");
    expect(principalLabel("worker", null)).toBe("Haven reader");
    expect(principalLabel("mail_receiver", null)).toBe("Email receipt");
  });
});

describe("reviewer verdicts on flagged Jev checks", () => {
  const checks: ProposalRow["checks"] = [
    { code: "jev_legible_complete", label: "Legible and complete", result: "pass", source: "jev" },
    { code: "jev_facility_named", label: "Names this facility", result: "fail", source: "jev" },
    { code: "jev_signed", label: "Signed", result: "unknown", source: "jev" },
    { code: "license_current", label: "License current", result: "fail", source: "code" },
    { code: "reader_pages", label: "Pages read", result: "unknown", source: "reader" },
  ];
  const ran = { checks, stage_status: { jev: { state: "ran" as const } } };

  it("flags only Jev checks that failed or are unknown", () => {
    expect(flaggedJevChecks(ran).map((c) => c.code)).toEqual(["jev_facility_named", "jev_signed"]);
    expect(flaggedJevChecks(null)).toEqual([]);
  });

  it("is complete only when every flagged check has a verdict, once Jev ran", () => {
    expect(verdictsComplete(ran, {})).toBe(false);
    expect(verdictsComplete(ran, { jev_facility_named: "wrong" })).toBe(false);
    expect(verdictsComplete(ran, { jev_facility_named: "wrong", jev_signed: "cant_tell" })).toBe(true);
    expect(verdictsComplete({ checks: [checks[0]!, checks[3]!], stage_status: { jev: { state: "ran" } } }, {})).toBe(true);
  });

  it("does not ask for verdicts when Jev did not run, or when there is no proposal", () => {
    expect(verdictsComplete({ checks, stage_status: { jev: { state: "not_authorized" } } }, {})).toBe(true);
    expect(verdictsComplete({ checks, stage_status: {} }, {})).toBe(true);
    expect(verdictsComplete(null, {})).toBe(true);
  });

  it("sends only verdicts for this proposal's flagged Jev checks", () => {
    expect(verdictsForFiling(ran, { jev_facility_named: "right", jev_legible_complete: "right", stale_code: "wrong" })).toEqual({ jev_facility_named: "right" });
  });
});
