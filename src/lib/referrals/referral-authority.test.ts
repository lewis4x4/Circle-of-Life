import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureReferralEpisode,
  createAuthorizedReferralLead,
  createAuthorizedReferralLeadFromHl7,
  createAuthorizedReferralSource,
  exportAuthorizedReferralLeads,
  loadAuthorizedReferralLeads,
  loadReferralEpisodeDownstreamReview,
  loadReferralEpisodeHistory,
  loadReferralEpisodeModel,
  loadReferralDuplicateCandidates,
  REFERRAL_INITIAL_REVISION,
  runReferralEpisodeCommand,
  submitReferralTriage,
  updateAuthorizedReferralLead,
} from "./referral-authority";

const rpc = vi.fn();
const client = { rpc } as never;

beforeEach(() => {
  rpc.mockReset();
});

describe("referral current-authority adapter", () => {
  it("loads and exports only through the authorized projections", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "lead-a",
          first_name: "Avery",
          last_name: "Resident",
          referral_source_name: "Hospital",
          can_read_clinical: false,
          can_write: false,
        },
      ],
      error: null,
    });

    await expect(
      loadAuthorizedReferralLeads(client, { facilityId: "facility-a", limit: 60 }),
    ).resolves.toMatchObject([
      {
        id: "lead-a",
        referral_sources: { name: "Hospital" },
        can_read_clinical: false,
        can_write: false,
      },
    ]);
    expect(rpc).toHaveBeenLastCalledWith("referral_leads_authorized_read", {
      p_facility_id: "facility-a",
      p_lead_id: null,
      p_status: null,
      p_limit: 60,
      p_offset: 0,
    });

    await exportAuthorizedReferralLeads(client, {
      facilityId: "facility-a",
      status: "contacted",
    });
    expect(rpc).toHaveBeenLastCalledWith("referral_leads_authorized_export", {
      p_facility_id: "facility-a",
      p_status: "contacted",
      p_limit: 500,
      p_offset: 0,
    });
  });

  it("does not submit client organization or actor identity on create and update", async () => {
    rpc.mockResolvedValue({ data: "created-id", error: null });

    await createAuthorizedReferralLead(client, {
      facilityId: "facility-a",
      firstName: "Avery",
      lastName: "Resident",
      referralSourceId: "source-a",
      preferredContact: "phone",
      phone: "555-111-2222",
    });
    expect(rpc).toHaveBeenLastCalledWith("referral_lead_create", {
      p_facility_id: "facility-a",
      p_first_name: "Avery",
      p_last_name: "Resident",
      p_referral_source_id: "source-a",
      p_phone: "555-111-2222",
      p_email: null,
      p_preferred_contact: "phone",
      p_inquiry_date: null,
    });
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("organization_id");
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("created_by");

    await updateAuthorizedReferralLead(client, {
      leadId: "lead-a",
      expectedUpdatedAt: "2026-09-14T12:00:00Z",
      patch: { status: "contacted" },
    });
    expect(rpc).toHaveBeenLastCalledWith("referral_lead_update", {
      p_lead_id: "lead-a",
      p_expected_updated_at: "2026-09-14T12:00:00Z",
      p_patch: { status: "contacted" },
    });

    await createAuthorizedReferralSource(client, {
      facilityId: "facility-a",
      name: "Hospital",
      sourceType: "hospital",
      facilityOnly: true,
    });
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("organization_id");
    expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("created_by");
  });

  it("links processed HL7 intake through one scoped command", async () => {
    rpc.mockResolvedValue({ data: "lead-a", error: null });
    await createAuthorizedReferralLeadFromHl7(client, "inbound-a");
    expect(rpc).toHaveBeenLastCalledWith("referral_lead_create_from_hl7", {
      p_inbound_id: "inbound-a",
    });
  });

  it("routes no-facility intake and duplicate review through their restricted RPCs", async () => {
    rpc.mockResolvedValue({ data: "triage-a", error: null });
    await submitReferralTriage(client, {
      displayName: "Avery Resident",
      sourceChannel: "phone",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "referral_triage_submit",
      expect.objectContaining({
        p_display_name: "Avery Resident",
        p_source_channel: "phone",
      }),
    );

    rpc.mockResolvedValue({ data: [], error: null });
    await loadReferralDuplicateCandidates(client, "lead-a");
    expect(rpc).toHaveBeenLastCalledWith("referral_duplicate_candidates", {
      p_lead_id: "lead-a",
    });
  });

  it("propagates authority and concurrency failures without substituting empty data", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Referral lead changed" } });
    await expect(
      updateAuthorizedReferralLead(client, {
        leadId: "lead-a",
        expectedUpdatedAt: "stale",
        patch: { status: "contacted" },
      }),
    ).rejects.toEqual({ message: "Referral lead changed" });
  });

  it("captures unknown receipt time without inventing an inquiry date", async () => {
    rpc.mockResolvedValue({
      data: {
        episode_id: "episode-a",
        episode_revision: "a".repeat(64),
        status: "new",
        work_state: "unassigned",
        event_id: "event-a",
        event_kind: "captured",
        replayed: false,
      },
      error: null,
    });

    await captureReferralEpisode(client, {
      requestKey: "capture:unknown:001",
      facilityId: "facility-a",
      firstName: "Same",
      lastName: "Name",
      receipt: { precision: "unknown" },
    });

    expect(rpc).toHaveBeenLastCalledWith("referral_episode_capture", {
      p_request_key: "capture:unknown:001",
      p_expected_revision: REFERRAL_INITIAL_REVISION,
      p_payload: expect.objectContaining({
        facility_id: "facility-a",
        first_name: "Same",
        last_name: "Name",
        receipt_precision: "unknown",
        source_kind: "native",
        source_reference: {},
      }),
    });
    expect(rpc.mock.calls.at(-1)?.[1]?.p_payload).not.toHaveProperty("inquiry_date");
    expect(rpc.mock.calls.at(-1)?.[1]?.p_payload).not.toHaveProperty("receipt_effective_at");
  });

  it("uses an existing opportunity revision for explicit multi-site capture", async () => {
    rpc.mockResolvedValue({ data: { episode_id: "episode-b" }, error: null });

    await captureReferralEpisode(client, {
      requestKey: "capture:site-b:001",
      expectedRevision: "b".repeat(64),
      facilityId: "facility-b",
      existingPersonId: "person-a",
      existingOpportunityId: "opportunity-a",
      receipt: { precision: "date", date: "2026-09-13" },
      sourceKind: "import",
      sourceReference: { workbook_row: "Referrals!18" },
    });

    expect(rpc).toHaveBeenLastCalledWith("referral_episode_capture", {
      p_request_key: "capture:site-b:001",
      p_expected_revision: "b".repeat(64),
      p_payload: expect.objectContaining({
        facility_id: "facility-b",
        existing_person_id: "person-a",
        existing_opportunity_id: "opportunity-a",
        receipt_precision: "date",
        inquiry_date: "2026-09-13",
        source_kind: "import",
        source_reference: { workbook_row: "Referrals!18" },
      }),
    });
  });

  it("serializes effective event precision and reviewed identity commands", async () => {
    rpc.mockResolvedValue({ data: { episode_id: "episode-a" }, error: null });

    await runReferralEpisodeCommand(client, {
      episodeId: "episode-a",
      requestKey: "interaction:episode-a:001",
      expectedRevision: "c".repeat(64),
      command: {
        kind: "record_interaction",
        summary: "Family called the facility.",
        effective: { precision: "instant", at: "2026-09-14T18:00:00Z" },
        next_action: "Return requested pricing details",
        next_action_at: "2026-09-15T14:00:00Z",
      },
    });
    expect(rpc).toHaveBeenLastCalledWith("referral_episode_command", {
      p_episode_id: "episode-a",
      p_request_key: "interaction:episode-a:001",
      p_expected_revision: "c".repeat(64),
      p_command: "record_interaction",
      p_payload: {
        summary: "Family called the facility.",
        next_action: "Return requested pricing details",
        next_action_at: "2026-09-15T14:00:00Z",
        effective_precision: "instant",
        effective_at: "2026-09-14T18:00:00Z",
      },
    });

    const review = {
      reviewed: true as const,
      referral_lead_id: "episode-a",
      admission_cases: [],
      workflow_events: [],
      hl7_inbound: [],
      outreach_activities: [],
      person_contacts: [],
      contact_permissions: [],
    };
    await runReferralEpisodeCommand(client, {
      episodeId: "episode-a",
      requestKey: "identity:episode-a:001",
      expectedRevision: "d".repeat(64),
      command: {
        kind: "identity_merge",
        target_opportunity_id: "opportunity-b",
        target_opportunity_revision: "f".repeat(64),
        reason: "Two staff-created episodes were reviewed together.",
        downstream_review: review,
      },
    });
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_command: "identity_merge",
      p_payload: { downstream_review: review },
    });

    rpc.mockResolvedValue({ data: review, error: null });
    await expect(loadReferralEpisodeDownstreamReview(client, "episode-a")).resolves.toEqual(review);
    expect(rpc).toHaveBeenLastCalledWith("referral_episode_downstream_review", {
      p_episode_id: "episode-a",
    });

    rpc.mockResolvedValue({ data: { events: [], next_before_sequence: null }, error: null });
    await loadReferralEpisodeHistory(client, {
      episodeId: "episode-a",
      beforeSequence: 20,
      limit: 10,
    });
    expect(rpc).toHaveBeenLastCalledWith("referral_episode_history_read", {
      p_episode_id: "episode-a",
      p_before_sequence: 20,
      p_limit: 10,
    });

    rpc.mockResolvedValue({
      data: {
        episode: { id: "episode-a", episode_revision: "e".repeat(64) },
        contacts: [],
      },
      error: null,
    });
    await loadReferralEpisodeModel(client, "episode-a");
    expect(rpc).toHaveBeenLastCalledWith("referral_episode_model_read", {
      p_episode_id: "episode-a",
    });
  });
});
