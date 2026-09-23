/**
 * What the transportation hub tiles and compliance queues know (COL-649).
 *
 * Under "All facilities" the hub reads nothing, so "Active fleet 0 / drivers 0"
 * was not data; after a failed read the queues said "No Driver Alerts"; and
 * an empty roster read "Inbox Zero". The queues claim "nothing expiring" only
 * through canClaimAllClear — a successful read over at least one driver or
 * vehicle.
 */
import {
  canClaimAllClear,
  metricLoading,
  metricNeedsFacility,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";

export function transportHubTileStates(input: {
  facilityReady: boolean;
  loading: boolean;
  error: unknown;
  fleetCount: number;
  driverCount: number;
}): { fleet: MetricState<number>; drivers: MetricState<number> } {
  if (!input.facilityReady) {
    const s = metricNeedsFacility<number>();
    return { fleet: s, drivers: s };
  }
  if (input.loading) return { fleet: metricLoading(), drivers: metricLoading() };
  if (input.error) return { fleet: metricUnavailable(), drivers: metricUnavailable() };
  return { fleet: metricValue(input.fleetCount), drivers: metricValue(input.driverCount) };
}

export type ComplianceQueueEmptyCopy = { title: string; body: string };

export function complianceQueueEmptyCopy(input: {
  kind: "driver" | "vehicle";
  error: unknown;
  /** Drivers (or vehicles) on file for the facility. */
  scopeSize: number;
  windowDays: number;
}): ComplianceQueueEmptyCopy {
  const noun = input.kind === "driver" ? "driver" : "vehicle";
  if (input.error) {
    return {
      title: "Couldn't check expirations",
      body: `The ${noun} records could not be read, so this is not an all-clear.`,
    };
  }
  if (canClaimAllClear({ scopeSize: input.scopeSize, issueCount: 0 })) {
    return input.kind === "driver"
      ? {
          title: "No Driver Alerts",
          body: `No license or medical card expiring within ${input.windowDays} days.`,
        }
      : {
          title: "No Vehicle Alerts",
          body: `No insurance or registration expiring within ${input.windowDays} days.`,
        };
  }
  return input.kind === "driver"
    ? {
        title: "No drivers on file",
        body: "Add driver credentials to track license and medical card expirations.",
      }
    : {
        title: "No Fleet Units",
        body: "Register a vehicle to track insurance and registration expirations.",
      };
}
