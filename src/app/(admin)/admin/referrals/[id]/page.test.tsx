import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminReferralLeadDetailPage from "@/app/(admin)/admin/referrals/[id]/page";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const loadLeadsMock = vi.hoisted(() => vi.fn());
const loadModelMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: LEAD_ID }),
  usePathname: () => `/admin/referrals/${LEAD_ID}`,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../referrals-hub-nav", () => ({
  ReferralsHubNav: () => <div data-testid="referrals-hub-nav" />,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            not: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/referrals/referral-authority", () => ({
  loadAuthorizedReferralLeads: loadLeadsMock,
  loadReferralEpisodeModel: loadModelMock,
  updateAuthorizedReferralLead: vi.fn(),
}));

function lead() {
  return {
    id: LEAD_ID,
    facility_id: "22222222-2222-4222-8222-222222222222",
    first_name: "Avery",
    last_name: "Resident",
    preferred_name: null,
    status: "new",
    pii_access_tier: "standard_ops",
    phone: null,
    email: null,
    notes: null,
    date_of_birth: null,
    converted_resident_id: null,
    converted_at: null,
    created_at: "2026-09-15T20:00:00Z",
    updated_at: "2026-09-15T20:00:00Z",
    tour_scheduled_for: null,
    tour_completed_at: null,
    tour_owner_user_id: null,
    tour_expected_week: null,
    referral_sources: { name: "Synthetic General Hospital" },
    can_read_clinical: false,
    can_write: true,
  };
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    person_contact_id: "pc-1",
    person_id: "person-1",
    originating_referral_lead_id: LEAD_ID,
    belongs_to_current_person: true,
    contact_id: "contact-1",
    first_name: "Jordan",
    last_name: "Caller",
    relationship: "Child",
    is_primary: true,
    phone: "(555) 123-4567",
    email: null,
    permissions: [
      { channel: "phone", permission_state: "unknown", evidence_note: null, recorded_at: "2026-09-15T20:00:00Z", recorded_by: null, permission_revision: "r" },
      { channel: "sms", permission_state: "unknown", evidence_note: null, recorded_at: "2026-09-15T20:00:00Z", recorded_by: null, permission_revision: "r" },
      { channel: "email", permission_state: "unknown", evidence_note: null, recorded_at: "2026-09-15T20:00:00Z", recorded_by: null, permission_revision: "r" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  loadLeadsMock.mockReset();
  loadLeadsMock.mockResolvedValue([lead()]);
  loadModelMock.mockReset();
});

describe("Lead detail — contacts", () => {
  it("shows a linked primary contact with relationship and unrecorded permissions", async () => {
    loadModelMock.mockResolvedValue({ contacts: [contact()] });

    render(<AdminReferralLeadDetailPage />);

    const section = (await screen.findByRole("heading", { name: "Contacts" })).closest("section") ?? document.body;
    expect(section).toHaveTextContent("Jordan Caller");
    expect(section).toHaveTextContent("Child");
    expect(section).toHaveTextContent("Primary contact");
    expect(section).toHaveTextContent("(555) 123-4567");
    expect(section).toHaveTextContent("Contact permissions not recorded.");
  });

  it("says when no separate contact exists and whose details the lead's own are", async () => {
    loadModelMock.mockResolvedValue({ contacts: [contact({ belongs_to_current_person: false })] });

    render(<AdminReferralLeadDetailPage />);

    expect(await screen.findByText(/No separate contact is recorded\. The phone and email above are the prospective resident's own\./)).toBeInTheDocument();
  });

  it("keeps the lead on screen when contacts cannot be read", async () => {
    loadModelMock.mockRejectedValue(new Error("Referral read authority required"));

    render(<AdminReferralLeadDetailPage />);

    expect(await screen.findByText(/Contacts could not be read: Referral read authority required/)).toBeInTheDocument();
    expect(screen.getByText("Avery Resident")).toBeInTheDocument();
  });
});
