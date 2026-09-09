import { describe, expect, it } from "vitest";

import sourceFixture from "../../../docs/facility-operations/fixtures/admin-log-source-items.json";
import catalogData from "./activity-catalog.json";
import { activityCatalog, parseActivityCatalog } from "./activity-catalog";

function entry(sourceId: string) {
  return activityCatalog.entries.find((item) => item.sourceId === sourceId)!;
}

describe("Admin Log activity catalog provenance", () => {
  it("preserves exactly all 91 independently retained source rows, including source whitespace", () => {
    expect(activityCatalog.source).toEqual(sourceFixture.source);
    expect(activityCatalog.entries.map((item) => ({
      id: item.sourceId,
      sheet: item.sourceSheet,
      cell: item.sourceCell,
      source_text: item.sourceText,
      timing_evidence: item.sourceTimingEvidence,
      question_ids: item.questionIds,
      proposed_capture: item.proposedCapture,
    }))).toEqual(sourceFixture.items);
    expect(activityCatalog.entries).toHaveLength(91);
    expect(new Set(activityCatalog.entries.map((item) => item.sourceId)).size).toBe(91);
    expect(entry("AL-D04").sourceText).toBe("Make deposits - Scan copies ");
  });

  it("rejects a missing mapping even when a duplicate keeps the count at 91", () => {
    const copy = structuredClone(catalogData);
    copy.entries[1] = structuredClone(copy.entries[0]);
    expect(() => parseActivityCatalog(copy)).toThrow(/Missing source mapping: AL-D02/);
    expect(() => parseActivityCatalog({ ...catalogData, entries: catalogData.entries.slice(1) })).toThrow();
  });

  it("rejects invented blank-header duties and duplicate source cells", () => {
    const copy = structuredClone(catalogData);
    copy.entries[0].sourceId = "AL-W09";
    expect(() => parseActivityCatalog(copy)).toThrow(/unknown Admin Log source ID/);
    copy.entries[0] = structuredClone(catalogData.entries[0]);
    copy.entries[1].sourceCell = copy.entries[0].sourceCell;
    expect(() => parseActivityCatalog(copy)).toThrow(/Duplicate source cell/);
  });

  it("keeps all design mappings draft without approving rules, effort or historical performance", () => {
    for (const item of activityCatalog.entries) {
      expect(item.status).toBe("draft");
      expect(item.approvedRule).toBeNull();
      expect(item.effortMinutes).toBeNull();
      expect(item.sourceText.trim()).not.toMatch(/^[YN]$/);
    }
    for (const executionProperty of ["completedAt", "performedBy", "schedule", "evidenceRequired"]) {
      const copy = structuredClone(catalogData);
      Object.assign(copy.entries[0], { [executionProperty]: "imported-from-Y" });
      expect(() => parseActivityCatalog(copy)).toThrow();
    }
    const copy = structuredClone(catalogData);
    copy.entries[0].status = "completed";
    expect(() => parseActivityCatalog(copy)).toThrow();
  });
});

describe("source-supported activity semantics", () => {
  it("splits composite source duties while retaining exactly one source disposition", () => {
    expect(entry("AL-D02").components.map((component) => component.label)).toEqual([
      "Update referral log", "Update maintenance log",
    ]);
    expect(entry("AL-W01").components.map((component) => component.label)).toEqual([
      "Record generator test", "Record carbon monoxide check",
    ]);
    expect(entry("AL-M09").components).toHaveLength(3);
    expect(entry("AL-A07").components).toHaveLength(3);
    expect(entry("AL-N04").components).toHaveLength(2);
    expect(entry("AL-A11").components).toHaveLength(2);
  });

  it("does not collapse an audit into performance or force composite components to share subjects", () => {
    expect(entry("AL-W01").kind).toBe("structured_observation");
    expect(entry("AL-A08").kind).toBe("record_review");
    expect(entry("AL-A08").components[0].id).not.toBe(entry("AL-W01").components[0].id);
    expect(entry("AL-M05").kind).toBe("event_checklist");
    expect(entry("AL-A07").kind).toBe("record_review");
    expect(entry("AL-A07").components[2].subjectKind).toBe("asset");
    expect(entry("AL-A07").components[2].kind).toBe("structured_observation");
  });

  it("preserves hire, review, expiry and completion dates as fields", () => {
    for (const sourceId of ["AL-E01", "AL-E03", "AL-E05", "AL-E06", "AL-E07", "AL-E08", "AL-E11"]) {
      expect(entry(sourceId).kind).toBe("data_field");
      expect(entry(sourceId).subjectKind).toBe("employee");
    }
    expect(entry("AL-E11").effortMinutes).toBeNull();
    expect(entry("AL-E14").approvedRule).toBeNull();
    expect(entry("AL-Y07").approvedRule).toBeNull();
  });

  it("keeps unresolved acronyms, subjects and plan semantics visible without inventing meanings", () => {
    for (const sourceId of ["AL-D12", "AL-D15", "AL-M09", "AL-M12", "AL-A02", "AL-A10", "AL-E04", "AL-H01"]) {
      expect(entry(sourceId).disposition).toBe("needs_confirmation");
      expect(entry(sourceId).confirmationReason).toBeTruthy();
    }
    expect(entry("AL-A02").components[0].label).toBe("MORS");
    expect(entry("AL-A02").subjectKind).toBeNull();
    expect(entry("AL-M12").subjectKind).toBeNull();
    expect(entry("AL-M09").components[1].subjectKind).toBeNull();
    expect(entry("AL-D15").subjectKind).toBeNull();
    expect(entry("AL-E04").subjectKind).toBe("employee");
  });

  it("requires an explicit disposition reason for unresolved source meaning", () => {
    const copy = structuredClone(catalogData);
    copy.entries.find((item) => item.sourceId === "AL-A02")!.confirmationReason = null;
    expect(() => parseActivityCatalog(copy)).toThrow(/require a reason/);
    copy.entries.find((item) => item.sourceId === "AL-A02")!.disposition = "mapped";
    expect(() => parseActivityCatalog(copy)).toThrow(/Unknown subjects require confirmation/);
  });
});

describe("stable activity identity", () => {
  it("pins allocated identities across later catalog revisions", () => {
    expect(entry("AL-D02").components.map(({ key, id }) => ({ key, id }))).toEqual([
      { key: "hfo-al-d02-01", id: "73a5af51-9f79-43cc-b7be-91ebe77b565e" },
      { key: "hfo-al-d02-02", id: "d5fca692-4d4d-48bb-b298-72726907b985" },
    ]);
    expect(entry("AL-E01").components[0].id).toBe("692e4ad1-bbf0-459a-babc-b271de6d29b8");
  });

  it("retains component identity when wording, source location and fingerprint change", () => {
    const copy = structuredClone(catalogData);
    copy.source.sha256 = "a".repeat(64);
    copy.entries[0].sourceText = "Revised source wording";
    copy.entries[0].sourceCell = "A42";
    copy.entries[0].components[0].label = "Revised display wording";
    const revised = parseActivityCatalog(copy);
    expect(revised.entries[0].components[0].id).toBe(entry("AL-D01").components[0].id);
    expect(revised.entries[0].components[0].key).toBe(entry("AL-D01").components[0].key);
  });

  it("rejects reused component keys and UUIDs, and invalid UUIDs", () => {
    for (const field of ["key", "id"] as const) {
      const copy = structuredClone(catalogData);
      copy.entries[1].components[0][field] = copy.entries[0].components[0][field];
      expect(() => parseActivityCatalog(copy)).toThrow(/Duplicate activity identity/);
    }
    const copy = structuredClone(catalogData);
    copy.entries[0].components[0].id = "derived-from-label";
    expect(() => parseActivityCatalog(copy)).toThrow();
  });
});
