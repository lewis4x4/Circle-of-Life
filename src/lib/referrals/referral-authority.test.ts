import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthorizedReferralLead,
  createAuthorizedReferralLeadFromHl7,
  createAuthorizedReferralSource,
  exportAuthorizedReferralLeads,
  loadAuthorizedReferralLeads,
  loadReferralDuplicateCandidates,
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
});
