import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminReferralLeadDetailPage from "@/app/(admin)/admin/referrals/[id]/page";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const loadLeadsMock = vi.hoisted(() => vi.fn());
const loadModelMock = vi.hoisted(() => vi.fn());
const loadHistoryMock = vi.hoisted(() => vi.fn());
const runCommandMock = vi.hoisted(() => vi.fn());

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
  loadReferralEpisodeHistory: loadHistoryMock,
  runReferralEpisodeCommand: runCommandMock,
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
  loadHistoryMock.mockReset();
  loadHistoryMock.mockResolvedValue({ events: [], next_before_sequence: null });
  runCommandMock.mockReset();
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

const REVISION = "a".repeat(64);

function episode(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    work_state: "unassigned",
    episode_revision: REVISION,
    next_action: null,
    next_action_at: null,
    is_overdue: false,
    ...overrides,
  };
}

function historyEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-2",
    event_sequence: 2,
    event_kind: "interaction_recorded",
    from_status: "new",
    to_status: "new",
    from_work_state: "unassigned",
    to_work_state: "unassigned",
    effective_precision: "instant",
    effective_at: "2026-09-24T14:30:00Z",
    effective_date: null,
    recorded_at: "2026-09-24T14:35:00Z",
    actor_id: "user-1",
    actor_role: "recruiter",
    actor_name: "Robin Recruiter",
    request_key: "contact-log:one",
    source_kind: "native",
    source_reference: {},
    details: {
      summary: "Daughter wants a tour next week.",
      method: "phone_call",
      contacted_name: "Jordan Caller (Child)",
      next_action: "Call back to book the tour",
      next_action_at: "2026-09-26T13:00:00Z",
    },
    ...overrides,
  };
}

describe("Lead detail — contact log", () => {
  it("shows the full history newest first with how, who, what and by whom", async () => {
    loadModelMock.mockResolvedValue({ contacts: [contact()], episode: episode() });
    loadHistoryMock.mockResolvedValue({
      events: [
        historyEvent(),
        historyEvent({
          id: "event-1",
          event_sequence: 1,
          event_kind: "captured",
          effective_precision: "unknown",
          effective_at: null,
          recorded_at: "2026-09-20T12:00:00Z",
          actor_name: "Morgan Admin",
          actor_role: "facility_admin",
          details: {},
        }),
      ],
      next_before_sequence: null,
    });

    render(<AdminReferralLeadDetailPage />);

    const history = await screen.findByRole("list", { name: "Referral history" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Phone call");
    expect(entries[0]).toHaveTextContent("With Jordan Caller (Child)");
    expect(entries[0]).toHaveTextContent("Daughter wants a tour next week.");
    expect(entries[0]).toHaveTextContent("Next step: Call back to book the tour");
    expect(entries[0]).toHaveTextContent("By Robin Recruiter, Recruiter");
    expect(entries[1]).toHaveTextContent("Referral received");
    expect(entries[1]).toHaveTextContent("By Morgan Admin, Administrator");
    expect(loadHistoryMock).toHaveBeenCalledWith(expect.anything(), { episodeId: LEAD_ID, limit: 200 });
  });

  it("says when an entry's note is withheld from the reader instead of showing it empty", async () => {
    loadModelMock.mockResolvedValue({ contacts: [], episode: episode() });
    loadHistoryMock.mockResolvedValue({ events: [historyEvent({ details: {} })], next_before_sequence: null });

    render(<AdminReferralLeadDetailPage />);

    expect(await screen.findByText("Contact logged")).toBeInTheDocument();
    expect(screen.getByText("The note on this entry is restricted for your role.")).toBeInTheDocument();
  });

  it("opens empty, refuses an incomplete entry, then logs a contact through the episode command", async () => {
    const user = userEvent.setup();
    loadModelMock.mockResolvedValue({ contacts: [contact()], episode: episode() });
    runCommandMock.mockResolvedValue({ episode_id: LEAD_ID, episode_revision: "b".repeat(64), event_kind: "interaction_recorded" });

    render(<AdminReferralLeadDetailPage />);

    const form = await screen.findByRole("form", { name: "Log a contact" });
    const when = within(form).getByLabelText("When the contact happened (Eastern Time)") as HTMLInputElement;
    const how = within(form).getByLabelText("How the contact happened") as HTMLSelectElement;
    const who = within(form).getByLabelText("Who the contact was with") as HTMLSelectElement;
    const what = within(form).getByLabelText("What was said or done") as HTMLTextAreaElement;
    expect(when.value).toBe("");
    expect(how.value).toBe("");
    expect(who.value).toBe("");
    expect(what.value).toBe("");

    await user.click(within(form).getByRole("button", { name: "Log contact" }));
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(within(form).getByText("Choose how the contact happened.")).toBeInTheDocument();
    expect(within(form).getByText("Write what was said or done.")).toBeInTheDocument();

    await user.type(when, "2026-09-24T10:30");
    await user.selectOptions(how, "phone_call");
    await user.selectOptions(who, "contact:pc-1");
    await user.type(what, "Daughter wants a tour next week.");
    await user.type(within(form).getByLabelText("Next step after this contact"), "Call back to book the tour");
    await user.type(within(form).getByLabelText("Next step after this contact due (Eastern Time)"), "2026-09-26T09:00");
    await user.click(within(form).getByRole("button", { name: "Log contact" }));

    await waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(1));
    const [, input] = runCommandMock.mock.calls[0];
    expect(input).toMatchObject({
      episodeId: LEAD_ID,
      expectedRevision: REVISION,
      command: {
        kind: "record_interaction",
        summary: "Daughter wants a tour next week.",
        method: "phone_call",
        contacted_name: "Jordan Caller (Child)",
        person_contact_id: "pc-1",
        effective: { precision: "instant", at: "2026-09-24T14:30:00.000Z" },
        next_action: "Call back to book the tour",
        next_action_at: "2026-09-26T13:00:00.000Z",
      },
    });
    expect(input.requestKey).toMatch(/^contact-log:/);
    expect(await screen.findByText("Contact logged.")).toBeInTheDocument();
    expect(loadHistoryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(what.value).toBe("");
  });

  it("keeps the entry and asks for a fresh save when the lead changed underneath", async () => {
    const user = userEvent.setup();
    loadModelMock.mockResolvedValue({ contacts: [], episode: episode() });
    runCommandMock.mockRejectedValueOnce({ code: "40001", message: "Referral episode changed; reload before saving" });

    render(<AdminReferralLeadDetailPage />);

    const form = await screen.findByRole("form", { name: "Log a contact" });
    await user.type(within(form).getByLabelText("When the contact happened (Eastern Time)"), "2026-09-24T10:30");
    await user.selectOptions(within(form).getByLabelText("How the contact happened"), "in_person");
    await user.selectOptions(within(form).getByLabelText("Who the contact was with"), "prospect");
    await user.type(within(form).getByLabelText("What was said or done"), "Toured the dining room.");
    await user.click(within(form).getByRole("button", { name: "Log contact" }));

    expect(await screen.findByText(/Someone else updated this lead while you were writing/)).toBeInTheDocument();
    expect((within(form).getByLabelText("What was said or done") as HTMLTextAreaElement).value).toBe("Toured the dining room.");
    const firstKey = runCommandMock.mock.calls[0][1].requestKey;

    runCommandMock.mockResolvedValueOnce({ episode_id: LEAD_ID, episode_revision: "c".repeat(64), event_kind: "interaction_recorded" });
    await user.click(within(form).getByRole("button", { name: "Log contact" }));
    await waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(2));
    expect(runCommandMock.mock.calls[1][1].requestKey).not.toBe(firstKey);
    expect(runCommandMock.mock.calls[1][1].command).toMatchObject({ contacted_name: "Avery Resident (prospective resident)", person_contact_id: null });
  });

  it("sets a next step on its own", async () => {
    const user = userEvent.setup();
    loadModelMock.mockResolvedValue({
      contacts: [],
      episode: episode({ next_action: "Send the brochure", next_action_at: "2026-09-25T13:00:00Z", is_overdue: true }),
    });
    runCommandMock.mockResolvedValue({ episode_id: LEAD_ID, episode_revision: "d".repeat(64), event_kind: "next_action_set" });

    render(<AdminReferralLeadDetailPage />);

    expect(await screen.findByText("Send the brochure")).toBeInTheDocument();
    expect(screen.getByText(/\(overdue\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change next step" }));
    await user.type(screen.getByRole("textbox", { name: "Next step" }), "Book the tour");
    await user.type(screen.getByLabelText("Next step due (Eastern Time)"), "2026-09-27T09:00");
    await user.click(screen.getByRole("button", { name: "Save next step" }));

    await waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(1));
    expect(runCommandMock.mock.calls[0][1].command).toEqual({
      kind: "next_action",
      next_action: "Book the tour",
      next_action_at: "2026-09-27T13:00:00.000Z",
    });
  });

  it("offers no entry form on a closed referral or to a read-only role", async () => {
    loadModelMock.mockResolvedValue({ contacts: [], episode: episode({ work_state: "closed" }) });
    render(<AdminReferralLeadDetailPage />);
    expect(await screen.findByText("This referral is closed. Reopen it to log another contact.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Log a contact" })).not.toBeInTheDocument();
  });
});
