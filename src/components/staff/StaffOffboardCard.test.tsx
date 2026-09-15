import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffOffboardCard } from "./StaffOffboardCard";
import type { StaffProfileRow } from "@/lib/staff/staff-profile-edit";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

function staff(overrides: Partial<StaffProfileRow> = {}): StaffProfileRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    facility_id: "11111111-1111-4111-8111-111111111111",
    user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    first_name: "Harbor",
    last_name: "Example",
    preferred_name: null,
    phone: null,
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
    updated_at: "2026-09-15T12:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StaffOffboardCard", () => {
  it("posts offboard and returns the updated staff row", async () => {
    const updated = staff({ employment_status: "terminated", termination_date: "2026-09-15" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: updated,
        haven_access: "revoked",
        access_control_sync: "queued",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onStaffUpdated = vi.fn();
    const user = userEvent.setup();

    render(<StaffOffboardCard staff={staff()} canEdit onStaffUpdated={onStaffUpdated} />);
    await user.click(screen.getByRole("button", { name: /^offboard$/i }));
    await user.type(screen.getByLabelText(/reason/i), "left");
    await user.click(screen.getByRole("button", { name: /confirm offboard/i }));

    await waitFor(() => {
      expect(onStaffUpdated).toHaveBeenCalledWith(updated);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/staff/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/offboard",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers restore when employment is already ended", async () => {
    render(
      <StaffOffboardCard
        staff={staff({ employment_status: "terminated", termination_date: "2026-09-01" })}
        canEdit
        onStaffUpdated={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /restore employment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^offboard$/i })).not.toBeInTheDocument();
  });
});
