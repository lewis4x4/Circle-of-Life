import { describe, expect, it } from "vitest";

import { recommendCheck, recommendMargin, wilsonLower, type CheckRow, type OutcomeRow } from "./jev-accuracy";

// Spec Appendix E (acc.test.ts), same cases.
const rows = (spec: [number, boolean, number][]): OutcomeRow[] =>
  spec.flatMap(([m, ok, count]) => Array.from({ length: count }, () => ({ jev_margin: m, jev_top_correct: ok })));

const cr = (res: CheckRow["jev_result"], v: CheckRow["verdict"], count: number): CheckRow[] =>
  Array.from({ length: count }, () => ({ jev_result: res, verdict: v }));

describe("wilsonLower", () => {
  it("30 of 30 has a 95% lower bound of 0.8865", () => {
    expect(wilsonLower(30, 30).toFixed(4)).toBe("0.8865");
  });
});

describe("recommendMargin", () => {
  it("collects until 30 documents are evaluated", () => {
    expect(recommendMargin(rows([[0.5, true, 12]]), 0.2).action).toBe("collect");
  });

  it("loosens to 0.1, not 0.05, when the band (0.05, 0.1] is empty", () => {
    const a = recommendMargin(rows([[0.5, true, 30], [0.15, true, 10], [0.03, false, 3]]), 0.2);
    expect(a.action).toBe("loosen");
    expect((a as { to: number }).to).toBe(0.1);
  });

  it("does not let a big clean top mask a bad band", () => {
    const mask = recommendMargin(rows([[0.5, true, 200], [0.07, false, 5], [0.12, true, 3]]), 0.2);
    expect(mask.action).toBe("keep");
  });

  it("tightens when misses land above the current margin", () => {
    const b = recommendMargin(rows([[0.25, false, 3], [0.25, true, 7], [0.5, true, 25]]), 0.2);
    expect(b.action).toBe("tighten");
    expect((b as { to: number }).to).toBe(0.3);
  });

  it("turns pre-selection off when misses are everywhere", () => {
    const c = recommendMargin(rows([[0.7, false, 5], [0.7, true, 5], [0.3, false, 20]]), 0.2);
    expect(c.action).toBe("off");
  });

  it("keeps when mostly right but not enough to loosen", () => {
    const d = recommendMargin(rows([[0.5, true, 20], [0.1, true, 5], [0.05, false, 5]]), 0.2);
    expect(d.action).toBe("keep");
  });
});

describe("recommendCheck", () => {
  it("collects below 20 reviewer verdicts", () => {
    expect(recommendCheck(cr("fail", "right", 5)).action).toBe("collect");
  });

  it("rewords when Jev is unsure too often", () => {
    expect(recommendCheck([...cr("unknown", null, 10), ...cr("pass", null, 15)]).action).toBe("reword");
  });

  it("rewords when reviewers overrule Jev too often", () => {
    expect(recommendCheck([...cr("fail", "wrong", 6), ...cr("fail", "right", 16)]).action).toBe("reword");
  });

  it("keeps a check that holds up", () => {
    expect(recommendCheck([...cr("fail", "wrong", 2), ...cr("fail", "right", 20)]).action).toBe("keep");
  });
});
