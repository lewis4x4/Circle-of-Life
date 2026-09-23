import { describe, expect, it } from "vitest";

import { triageInboxEmptyCopy } from "./triage-inbox-empty-copy";

describe("triageInboxEmptyCopy (COL-649)", () => {
  it("does not say 'Inbox zero' beside open rounding escalations", () => {
    const copy = triageInboxEmptyCopy({ residentCount: 34, openEscalations: 1000, pendingWatchApprovals: 0 });
    expect(copy.clear).toBe(false);
    expect(copy.headline).not.toMatch(/zero/i);
    expect(copy.body).toContain("1000 open rounding escalations");
  });

  it("does not say 'Inbox zero' when no residents were in scope", () => {
    expect(triageInboxEmptyCopy({ residentCount: 0, openEscalations: 0, pendingWatchApprovals: 0 }).clear).toBe(false);
  });

  it("allows the all-clear when residents were covered and nothing is open", () => {
    expect(triageInboxEmptyCopy({ residentCount: 34, openEscalations: 0, pendingWatchApprovals: 0 })).toMatchObject({
      clear: true,
      headline: "Inbox zero",
    });
  });
});
