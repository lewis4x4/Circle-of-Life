import { createScalarConfigPromoter } from "./_scalar.ts";

export const M13_PROMOTER = createScalarConfigPromoter({
  moduleCode: "M13",
  description:
    "Promote maintenance/work-order configuration discovered during Facility Launch.",
  table: "facility_maintenance_config",
  fields: [
    "workOrderSource",
    "preventiveMaintenanceCadence",
    "maintenanceOwner",
  ],
  summaryLabel: "Maintenance configuration",
});
