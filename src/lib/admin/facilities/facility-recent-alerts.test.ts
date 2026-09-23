import { describe, expect, it } from "vitest";

import type { ThresholdRow } from "@/hooks/useFacilityThresholds";
import type { FacilityDetailRow } from "@/types/facility";

import { facilityRecentAlertsView } from "./facility-recent-alerts";

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const facility = { ahca_license_expiration: isoDaysFromNow(4) } as unknown as FacilityDetailRow;

const threshold = (type: string, yellow: number, red: number, enabled = true): ThresholdRow => ({
  id: type,
  threshold_type: type,
  yellow_threshold: yellow,
  red_threshold: red,
  notify_roles: [],
  enabled,
  alert_frequency: null,
  created_at: "",
  updated_at: "",
  updated_by: null,
  updated_by_display: null,
});

describe("facilityRecentAlertsView (COL-649)", () => {
  it("raises a licence expiring inside the configured window instead of 'No active alerts'", () => {
    const view = facilityRecentAlertsView({
      facility,
      thresholds: [threshold("license_expiry_days", 60, 30)],
      loading: false,
      error: null,
    });
    expect(view.status).toBe("firing");
    if (view.status === "firing") expect(view.lines[0]!.severity).toBe("red");
  });

  it("does not claim clear when no relevant threshold is enabled", () => {
    const view = facilityRecentAlertsView({
      facility,
      thresholds: [threshold("license_expiry_days", 60, 30, false)],
      loading: false,
      error: null,
    });
    expect(view.status).toBe("not_configured");
  });

  it("does not claim clear when thresholds could not be read", () => {
    expect(facilityRecentAlertsView({ facility, thresholds: [], loading: false, error: "500" }).status).toBe(
      "unavailable",
    );
  });

  it("claims clear only when an enabled threshold was evaluated and none fired", () => {
    const farFacility = { ahca_license_expiration: isoDaysFromNow(400) } as unknown as FacilityDetailRow;
    const view = facilityRecentAlertsView({
      facility: farFacility,
      thresholds: [threshold("license_expiry_days", 60, 30)],
      loading: false,
      error: null,
    });
    expect(view.status).toBe("clear");
  });

  it("does not count an occupancy threshold when no occupancy is posted", () => {
    const view = facilityRecentAlertsView({
      facility: { ahca_license_expiration: null } as unknown as FacilityDetailRow,
      thresholds: [threshold("occupancy_low_pct", 80, 70)],
      loading: false,
      error: null,
    });
    expect(view.status).toBe("not_configured");
  });
});
