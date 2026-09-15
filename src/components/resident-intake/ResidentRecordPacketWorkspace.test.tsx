import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResidentIntakeSnapshot } from "./types";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  command: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    loadResidentIntake: mocks.load,
    sendResidentIntakeCommand: mocks.command,
    requestResidentIntakeParse: mocks.parse,
  };
});

import { ResidentRecordPacketWorkspace } from "./ResidentRecordPacketWorkspace";

const INTAKE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";

function baseSnapshot(overrides: Partial<ResidentIntakeSnapshot> = {}): ResidentIntakeSnapshot {
  return {
    id: INTAKE_ID,
    title: "Resident admission packet",
    state: "review_populated",
    revision: REVISION,
    facilityId: "55555555-5555-4555-8555-555555555555",
    facilityName: "Homewood Lodge",
    residentId: "66666666-6666-4666-8666-666666666666",
    residentName: "Mary Johnson",
    admissionCaseId: null,
    sources: [{
      id: SOURCE_ID,
      title: "Face sheet.pdf",
      fileName: "Face sheet.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2000,
      state: "review",
      classification: "resident",
      documentType: "demographics_face_sheet",
      confidence: 0.91,
      quarantineReason: null,
      safetyConfirmed: true,
      requiresSafetyConfirmation: false,
      residentDocumentId: null,
      failureMessage: null,
    }],
    facts: [{
      id: FACT_ID,
      revision: "77777777-7777-4777-8777-777777777777",
      label: "Date of birth",
      fieldCode: "resident.date_of_birth",
      domain: "demographics",
      currentValue: "Not reviewed",
      proposedValue: "Jan 3, 1944",
      sourceLabel: "Face sheet.pdf",
      sourceId: SOURCE_ID,
      pageNumber: 1,
      confidence: 0.91,
      conflict: false,
      stale: false,
      requiredReviewer: "operational",
      state: "proposed",
      allowedActions: ["approve_fact", "reject_fact", "correct_fact"],
      canonicalFingerprint: "a".repeat(64),
    }],
    candidates: [],
    checklist: [{
      key: "demographics_face_sheet",
      label: "Demographics / face sheet",
      status: "present",
      count: 1,
      sourceId: SOURCE_ID,
      currentDocumentId: "88888888-8888-4888-8888-888888888888",
      canAdd: true,
      canReplace: true,
    }],
    permissions: { canReview: true, canApplyClinical: false, canApplyPayer: true, canApplyAuthority: true, canComplete: true },
    counts: { uploaded: 1, residentEligible: 1, excluded: 0, quarantined: 0, conflicting: 0, awaitingReview: 1, applied: 0 },
    ...overrides,
  };
}

function raw(snapshot: ResidentIntakeSnapshot) {
  return {
    intake: {
      id: snapshot.id,
      title: snapshot.title,
      state: "review",
      revision: snapshot.revision,
      facility_id: snapshot.facilityId,
      resident_id: snapshot.residentId,
      admission_case_id: snapshot.admissionCaseId,
    },
    sources: [], facts: [], matches: [], checklist: [], counts: {},
    can: { read: true, manage: true, clinical: false, payer: true, legal: true },
  };
}

describe("ResidentRecordPacketWorkspace", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.command.mockReset();
    mocks.parse.mockReset();
    mocks.load.mockResolvedValue(baseSnapshot());
    mocks.command.mockResolvedValue(raw(baseSnapshot()));
    mocks.parse.mockResolvedValue(raw(baseSnapshot()));
  });

  it("renders one explicit review state and the Current, Proposed, Document, Confidence comparison", async () => {
    render(<ResidentRecordPacketWorkspace intakeId={INTAKE_ID} />);
    expect(await screen.findByRole("heading", { name: "Facts ready for review" })).toBeVisible();
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getAllByText("Proposed")).toHaveLength(2);
    expect(screen.getByText("Source")).toBeVisible();
    expect(screen.getByText("Confidence")).toBeVisible();
    expect(screen.getByText("Jan 3, 1944")).toBeVisible();
    expect(screen.getByText("91%")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Apply to resident chart" })).toBeNull();
  });

  it("keeps credential-marked documents quarantined without a review button", async () => {
    mocks.load.mockResolvedValue(baseSnapshot({
      state: "quarantined",
      sources: [{ ...baseSnapshot().sources[0], state: "quarantined", classification: "credential_secret", quarantineReason: "credential_pattern" }],
      facts: [],
      counts: { ...baseSnapshot().counts, quarantined: 1, awaitingReview: 0 },
    }));
    render(<ResidentRecordPacketWorkspace intakeId={INTAKE_ID} />);
    expect(await screen.findByRole("heading", { name: "Credential review required" })).toBeVisible();
    expect(screen.getByText("Held away from resident records")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review document" })).toBeNull();
  });

  it("lets automated review determine an unclassified document type after safety clearance", async () => {
    mocks.load.mockResolvedValue(baseSnapshot({
      state: "ready_to_parse",
      sources: [{
        ...baseSnapshot().sources[0],
        state: "ready_to_parse",
        classification: null,
        documentType: null,
        safetyConfirmed: true,
      }],
      facts: [],
    }));
    render(<ResidentRecordPacketWorkspace intakeId={INTAKE_ID} />);
    const classify = await screen.findByRole("button", { name: "Classify and review" });
    await userEvent.click(classify);
    expect(mocks.parse).toHaveBeenCalledWith(expect.any(Object), SOURCE_ID, expect.any(String));
  });

  it("offers per-type Add and Replace while locking rapid adjacent actions to one revision", async () => {
    let resolveCommand!: (value: unknown) => void;
    mocks.command.mockImplementationOnce(() => new Promise((resolve) => { resolveCommand = resolve; }));
    render(<ResidentRecordPacketWorkspace intakeId={INTAKE_ID} />);
    await screen.findByRole("heading", { name: "Facts ready for review" });
    const add = screen.getByRole("button", { name: "Add to chart" });
    const replace = screen.getByRole("button", { name: "Replace" });
    fireEvent.click(add);
    fireEvent.click(replace);
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.command.mock.calls[0][1]).toBe("promote_source");
    expect(mocks.command.mock.calls[0][2]).toMatchObject({ mode: "add", source_id: SOURCE_ID });
    await act(async () => resolveCommand(raw(baseSnapshot())));
  });

  it("keeps approval and application separate and respects reviewer authority", async () => {
    const approved = { ...baseSnapshot().facts[0], state: "approved", domain: "clinical", allowedActions: [] };
    mocks.load.mockResolvedValue(baseSnapshot({ facts: [approved] }));
    const user = userEvent.setup();
    render(<ResidentRecordPacketWorkspace intakeId={INTAKE_ID} />);
    const apply = await screen.findByRole("button", { name: "Apply to resident chart" });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(mocks.command).not.toHaveBeenCalled();
  });
});
