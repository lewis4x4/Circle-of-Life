import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  describeFieldValue,
  describeHistoryChange,
  groupResidentRecordHistory,
  parseResidentRecordHistory,
} from "@/lib/residents/resident-record-history";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ResidentRecordHistory } from "./ResidentRecordHistory";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";

const RAW = {
  limit: 50,
  truncated: false,
  entries: [
    {
      id: "e2", field: "code_status", kind: "person", action: "verify", at: "2026-09-22T17:30:00Z", by_name: "Nurse Example",
      previous_value: { code_status: "dnr" }, new_value: { code_status: "dnr", verified: true },
    },
    {
      id: "e1", field: "code_status", kind: "person", action: "set", at: "2026-09-22T17:00:00Z", by_name: "Nurse Example",
      previous_value: { code_status: null }, new_value: { code_status: "dnr", verified: false },
    },
    {
      id: "d1", field: "allergy_list", kind: "document", action: "set", at: "2026-09-21T12:00:00Z", by_name: "Owner Example",
      document_value: "Latex", document_title: "Admission packet",
    },
    { id: "x", field: "not_a_field", kind: "person", action: "set", at: "2026-09-21T12:00:00Z" },
  ],
  stale: [{ field: "code_status", at: "2026-09-22T16:00:00Z", intake_id: INTAKE_ID, document_title: "Admission packet" }],
};

describe("COL-627 record history copy", () => {
  it("drops rows for unknown fields and keeps newest first per field", () => {
    const history = parseResidentRecordHistory(RAW)!;
    expect(history.entries.map((e) => e.id)).toEqual(["e2", "e1", "d1"]);
    const groups = groupResidentRecordHistory(history);
    expect(groups.map((g) => g.field)).toEqual(["code_status", "allergy_list"]);
    expect(groups[0].stale).toHaveLength(1);
  });

  it("says what changed in words, before → after", () => {
    const [verify, set, doc] = parseResidentRecordHistory(RAW)!.entries;
    expect(describeHistoryChange(set)).toBe("Not recorded → DNR — Do not resuscitate");
    expect(describeHistoryChange(verify)).toBe("Verified as DNR — Do not resuscitate");
    expect(describeHistoryChange(doc)).toBe("Set to Latex");
    expect(describeFieldValue("allergy_list", { allergy_list: [] })).toBe("No known allergies");
    expect(describeFieldValue("do_not_hospitalize", { do_not_hospitalize: true })).toBe("In effect");
    expect(describeFieldValue("primary_physician", { name: "Dr. A", phone: null })).toBe("Dr. A · phone not recorded");
  });

  it("returns null for a malformed payload rather than an empty history", () => {
    expect(parseResidentRecordHistory(null)).toBeNull();
    expect(parseResidentRecordHistory("nope")).toBeNull();
  });
});

describe("COL-627 ResidentRecordHistory", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("lists who changed what and when, the document source, and the stale notice with a review link", async () => {
    mocks.rpc.mockResolvedValue({ data: RAW, error: null });
    render(<ResidentRecordHistory residentId={RESIDENT_ID} reloadToken={0} />);
    await waitFor(() => expect(screen.getByText("Not recorded → DNR — Do not resuscitate")).toBeTruthy());
    expect(mocks.rpc).toHaveBeenCalledWith("resident_record_field_history", { p_resident_id: RESIDENT_ID, p_limit: 50 });
    const setRow = screen.getByText("Not recorded → DNR — Do not resuscitate").closest("li");
    expect(setRow?.textContent).toContain("Nurse Example, on the resident record · Sep 22, 2026, 1:00 PM EDT");
    expect(screen.getByText(/Applied by Owner Example from admission document “Admission packet”/)).toBeTruthy();
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "An admission-document value for this field was not applied because the record changed first. Review it in Admission documents",
    );
    expect(screen.getByRole("link", { name: "Review it in Admission documents" }).getAttribute("href")).toBe(
      `/admin/admissions/intake/${INTAKE_ID}`,
    );
    expect(screen.getByText(/Shows up to the latest 50 changes/)).toBeTruthy();
  });

  it("shows the notice without a link when the caller may not read intake, and states truncation", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...RAW, truncated: true, stale: [{ field: "code_status", at: "2026-09-22T16:00:00Z", intake_id: null, document_title: null }] },
      error: null,
    });
    render(<ResidentRecordHistory residentId={RESIDENT_ID} reloadToken={0} />);
    await waitFor(() => expect(screen.getByRole("note")).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Showing the latest 50 changes/)).toBeTruthy();
  });

  it("says so when the history cannot be read", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Resident unavailable" } });
    render(<ResidentRecordHistory residentId={RESIDENT_ID} reloadToken={0} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/));
  });
});
