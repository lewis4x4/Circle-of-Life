import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FAMILY_BULLETIN_EMPTY_DESCRIPTION,
  FAMILY_BULLETIN_EMPTY_TITLE,
  FAMILY_BULLETIN_ONE_WAY_HELPER,
  FAMILY_BULLETIN_PAGE_DESCRIPTION,
  FAMILY_BULLETIN_PAGE_TITLE,
} from "@/lib/admin/family-messages-copy";

import { StaffFamilyBulletinSection } from "./StaffFamilyBulletinSection";

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: "facility-1",
    availableFacilities: [],
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

describe("<StaffFamilyBulletinSection />", () => {
  it("leads with bulletin posting copy and one-way helper", () => {
    render(
      <StaffFamilyBulletinSection
        residentId=""
        onResidentChange={() => {}}
        draft=""
        deliveryMethod="portal_only"
        onDraftChange={() => {}}
        onDeliveryMethodChange={() => {}}
        onPost={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: /post a bulletin note/i })).toBeInTheDocument();
    expect(screen.getByText(FAMILY_BULLETIN_ONE_WAY_HELPER)).toBeInTheDocument();
    expect(screen.getByText(/select a resident to enable posting/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/type a reply/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
  });

  it("shows last posted timestamp when provided", () => {
    render(
      <StaffFamilyBulletinSection
        residentId="resident-1"
        lastPostedAtIso="2026-08-10T15:30:00.000Z"
        draft=""
        deliveryMethod="portal_only"
        onDraftChange={() => {}}
        onDeliveryMethodChange={() => {}}
        onPost={() => {}}
      />,
    );

    expect(screen.getByText(/last posted/i)).toBeInTheDocument();
  });
});

describe("family bulletin copy constants", () => {
  it("uses calm empty-state language without chat framing", () => {
    expect(FAMILY_BULLETIN_PAGE_TITLE).toMatch(/family portal notes/i);
    expect(FAMILY_BULLETIN_PAGE_DESCRIPTION).toMatch(/cannot reply/i);
    expect(FAMILY_BULLETIN_EMPTY_TITLE).toMatch(/no bulletin notes posted yet/i);
    expect(FAMILY_BULLETIN_EMPTY_DESCRIPTION).toMatch(/choose a resident/i);
    expect(FAMILY_BULLETIN_EMPTY_TITLE).not.toMatch(/conversation/i);
    expect(FAMILY_BULLETIN_EMPTY_DESCRIPTION).not.toMatch(/start the conversation/i);
  });
});
