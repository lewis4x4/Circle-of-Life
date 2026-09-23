import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminStaffDetailPage from "./page";
import type { StaffProfileRow } from "@/lib/staff/staff-profile-edit";

const STAFF_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FACILITY_ID = "11111111-1111-1111-1111-111111111111";

const mocks = vi.hoisted(() => ({
  appRole: "med_tech" as string,
  userId: "user-editor-1" as string | null,
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  lastUpdatePatch: null as Record<string, unknown> | null,
}));

function makeStaffRow(overrides: Partial<StaffProfileRow> = {}): StaffProfileRow {
  return {
    id: STAFF_ID,
    facility_id: FACILITY_ID,
    user_id: null,
    first_name: "Harbor",
    last_name: "Example",
    preferred_name: null,
    phone: "555-1000",
    phone_alt: null,
    email: null,
    address_line_1: null,
    address_line_2: null,
    city: null,
    state: null,
    zip: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    staff_role: "cna",
    employment_status: "active",
    hire_date: "2024-06-01",
    termination_date: null,
    termination_reason: null,
    hourly_rate: null,
    overtime_rate: null,
    is_full_time: true,
    is_float_pool: false,
    max_hours_per_week: null,
    photo_url: null,
    notes: null,
    updated_at: "2026-03-01T15:00:00Z",
    ...overrides,
  };
}

function makeClient(staff: StaffProfileRow) {
  const staffUpdateChain = {
    eq: () => ({
      select: () => ({
        single: async () => {
          const merged = { ...staff, ...mocks.lastUpdatePatch, updated_at: "2026-03-02T10:00:00Z" };
          return { data: merged, error: null };
        },
      }),
    }),
  };

  return {
    from: (table: string) => {
      if (table === "staff") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({ data: staff, error: null }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            mocks.lastUpdatePatch = patch;
            return staffUpdateChain;
          },
        };
      }
      if (table === "staff_certifications") {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          order: () => q,
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return q;
      }
      if (table === "shift_assignments") {
        const q = {
          select: () => q,
          eq: () => q,
          gte: () => q,
          is: () => q,
          in: () => q,
          order: () => q,
          limit: () => q,
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return q;
      }
      return {};
    },
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: STAFF_ID }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: mocks.userId ? { id: mocks.userId } : null,
    appRole: mocks.appRole,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeClient(makeStaffRow()),
}));

describe("AdminStaffDetailPage profile edit", () => {
  beforeEach(() => {
    mocks.appRole = "med_tech";
    mocks.userId = "user-editor-1";
    mocks.selectedFacilityId = FACILITY_ID;
    mocks.lastUpdatePatch = null;
    vi.clearAllMocks();
  });

  it("hides Edit actions for med_tech app role", async () => {
    render(<AdminStaffDetailPage />);
    expect(await screen.findByText("Harbor Example")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^offboard$/i })).not.toBeInTheDocument();
  });

  it("shows Edit for facility_admin and saves contact patch with null phone when cleared", async () => {
    mocks.appRole = "facility_admin";
    const user = userEvent.setup();

    render(<AdminStaffDetailPage />);
    expect(await screen.findByText("Harbor Example")).toBeInTheDocument();

    const editButtons = screen.getAllByRole("button", { name: /^edit$/i });
    expect(editButtons.length).toBeGreaterThan(0);
    const offboardButton = screen.getByRole("button", { name: /^offboard$/i });
    expect(offboardButton).toBeInTheDocument();

    const contactSection = screen.getByRole("region", { name: "Contact" });
    // The destructive block comes after who the person is, never first (COL-662).
    expect(contactSection.compareDocumentPosition(offboardButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const contactEdit = withinContactEdit(contactSection, editButtons);
    await user.click(contactEdit);

    const phoneInput = screen.getByDisplayValue("555-1000");
    await user.clear(phoneInput);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mocks.lastUpdatePatch).toMatchObject({
        updated_by: "user-editor-1",
        phone: null,
        phone_alt: null,
        email: null,
      });
    });
  });
});

function withinContactEdit(contactSection: HTMLElement, editButtons: HTMLElement[]): HTMLElement {
  for (const btn of editButtons) {
    if (contactSection.contains(btn)) return btn;
  }
  throw new Error("Contact section Edit button not found");
}
