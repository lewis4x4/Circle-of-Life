import { describe, expect, it } from "vitest";

import {
  formatFieldSource,
  linesToList,
  parseResidentRecordFieldStates,
  residentRecordEditErrorMessage,
} from "./resident-record-edit";

describe("COL-597 resident record edit helpers", () => {
  it("reads field states from the RPC and treats anything malformed as not editable", () => {
    const states = parseResidentRecordFieldStates({
      code_status: { can_edit: true, source: { kind: "person", at: "2026-09-22T17:26:56Z", by_name: "Jane Nurse", action: "verify" } },
      allergy_list: { can_edit: "yes", source: { kind: "document", at: "2026-09-12T12:00:00Z", by_name: null, document_title: "Packet" } },
    });
    expect(states?.code_status).toEqual({
      canEdit: true,
      source: { kind: "person", at: "2026-09-22T17:26:56Z", byName: "Jane Nurse", action: "verify" },
    });
    expect(states?.allergy_list.canEdit).toBe(false);
    expect(states?.diagnoses).toEqual({ canEdit: false, source: null });
    expect(parseResidentRecordFieldStates(null)).toBeNull();
  });

  it("says where a value came from, and never invents an actor", () => {
    expect(formatFieldSource({ kind: "person", at: "2026-09-22T17:26:56Z", byName: "Jane Nurse", action: "set" })).toBe(
      "Recorded on the resident record by Jane Nurse, Sep 22, 2026, 1:26 PM",
    );
    expect(formatFieldSource({ kind: "document", at: "2026-09-12T16:00:00Z", byName: null, documentTitle: "Admission packet" })).toBe(
      "From admission document “Admission packet”, applied by a staff member (not attributed), Sep 12, 2026, 12:00 PM",
    );
    expect(formatFieldSource(null)).toBe("Source not recorded");
  });

  it("splits one entry per line and keeps a case-only repeat once", () => {
    expect(linesToList(" Penicillin \n\npenicillin\nSulfa\r\n")).toEqual(["Penicillin", "Sulfa"]);
  });

  it("turns the RPC's refusals into operator copy", () => {
    expect(residentRecordEditErrorMessage({ code: "P0409", message: "x" })).toMatch(/changed this resident's record/);
    expect(residentRecordEditErrorMessage({ code: "42501", message: "x" })).toMatch(/Your role can't record this/);
    expect(residentRecordEditErrorMessage({ code: "22023", message: "Choose a code status" })).toBe("Choose a code status");
  });
});
