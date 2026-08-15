import { describe, expect, it, vi } from "vitest";

import { fetchAdminDashboardSnapshot } from "./admin-dashboard-snapshot";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("fetchAdminDashboardSnapshot", () => {
  it("loads and maps the Command Center through one governed RPC call", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        headlineName: "Oakridge ALF",
        timezoneLabel: "America/New_York",
        licensedBeds: 52,
        counts: {
          residentCount: 41,
          awayResidentCount: 2,
          activeStaffCount: 19,
          openIncidentAlerts: 3,
          staffingGapSnapshots24h: 1,
          medicationErrorsUnreviewed: 2,
          expiringCertifications30d: 4,
        },
        workflowQueues: {},
        residentAssurance: {
          activeWatches: 2,
          criticalSafetyResidents: 1,
        },
        censusPreview: [
          {
            id: "resident-1",
            first_name: "Avery",
            last_name: "Jones",
            facility_id: FACILITY_ID,
            status: "active",
            acuity_level: "level_2",
            updated_at: new Date().toISOString(),
            date_of_birth: "1942-05-07",
            bed_label: "A",
            room_number: "101",
          },
        ],
        acuityWatchlist: [],
        activity: [
          {
            id: "incident-1",
            occurred_at: new Date().toISOString(),
            category: "fall_without_injury",
            severity: "level_3",
            status: "open",
            resident_id: "resident-1",
            resident_first_name: "Avery",
            resident_last_name: "Jones",
          },
        ],
      },
      error: null,
    }));

    const snapshot = await fetchAdminDashboardSnapshot(FACILITY_ID, { rpc } as never);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_command_center_projection", {
      p_facility_id: FACILITY_ID,
    });
    expect(snapshot).toMatchObject({
      headlineName: "Oakridge ALF",
      licensedBeds: 52,
      residentCount: 41,
      activeStaffCount: 19,
      residentAssurance: {
        activeWatches: 2,
        criticalSafetyResidents: 1,
      },
    });
    expect(snapshot.censusPreview[0]).toMatchObject({
      name: "Avery Jones",
      room: "101-A",
      acuity: 2,
      statusLabel: "In facility",
    });
    expect(snapshot.activity[0]).toMatchObject({
      tone: "critical",
      message: "Avery Jones · fall without injury (open)",
      href: "/admin/incidents/incident-1",
    });
  });

  it("does not pass an invalid facility scope into the RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        headlineName: "All facilities",
        counts: {},
        workflowQueues: {},
        residentAssurance: {},
        censusPreview: [],
        acuityWatchlist: [],
        activity: [],
      },
      error: null,
    }));

    await fetchAdminDashboardSnapshot("not-a-uuid", { rpc } as never);

    expect(rpc).toHaveBeenCalledWith("admin_command_center_projection", {
      p_facility_id: null,
    });
  });
});
