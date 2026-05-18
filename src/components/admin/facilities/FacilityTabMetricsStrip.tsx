/**
 * @file Back-compat re-export — prefer importing {@link FacilityHeader} from `./FacilityHeader`.
 */

export type { FacilityHeaderProps } from "@/components/admin/facilities/FacilityHeader";
export {
  FacilityHeader,
  FacilityHeader as FacilityTabMetricsStrip,
  FacilityOverviewMetricsStrip,
  FacilityOperationsMetricsStrip,
} from "@/components/admin/facilities/FacilityHeader";
