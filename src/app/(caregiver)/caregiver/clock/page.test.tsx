import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ flag: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mock.getUser } }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/timeclock/facility-flag", () => ({ timeclockFlagForUser: mock.flag }));
vi.mock("@/components/caregiver/CaregiverClockPanel", () => ({
  CaregiverClockPanel: () => <button type="button">Clock in</button>,
}));

import AliasClockPage from "../../clock/page";
import CaregiverClockPage from "./page";

const MED_TECH = { id: "u1", app_metadata: { app_role: "med_tech" } };

async function renderPage(Page: () => Promise<ReactElement>) {
  render(await Page());
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.getUser.mockResolvedValue({ data: { user: MED_TECH } });
});

describe("/caregiver/clock (spec 40 §1, §10 item 7: one clock)", () => {
  it("is the same page as /clock, so both routes behave alike", () => {
    expect(CaregiverClockPage).toBe(AliasClockPage);
  });

  it("shows the front-door notice and no punch control where the kiosk timeclock is on", async () => {
    mock.flag.mockResolvedValue("on");
    await renderPage(CaregiverClockPage);
    expect(screen.getByRole("heading", { name: "Clock in at the front door" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /clock in/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to shift home" }).getAttribute("href")).toBe("/floor");
    expect(mock.flag).toHaveBeenCalledWith({}, "u1");
  });

  it("keeps the mobile punch where the timeclock is off", async () => {
    mock.flag.mockResolvedValue("off");
    await renderPage(CaregiverClockPage);
    expect(screen.getByRole("button", { name: "Clock in" })).toBeTruthy();
    expect(screen.queryByText("Clock in at the front door")).toBeNull();
  });

  it("falls back to the panel when the flag cannot be read; the punch route and the database then refuse", async () => {
    mock.flag.mockResolvedValue("unknown");
    await renderPage(CaregiverClockPage);
    expect(screen.getByRole("button", { name: "Clock in" })).toBeTruthy();
  });
});
