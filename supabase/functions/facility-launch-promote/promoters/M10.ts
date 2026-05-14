import { createScalarConfigPromoter } from "./_scalar.ts";

export const M10_PROMOTER = createScalarConfigPromoter({
  moduleCode: "M10",
  description:
    "Promote medication integration configuration discovered during Facility Launch.",
  table: "facility_medication_config",
  fields: ["medicationScope", "marSource", "medicationOwner"],
  summaryLabel: "Medication configuration",
});
