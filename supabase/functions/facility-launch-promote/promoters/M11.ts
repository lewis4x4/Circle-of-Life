import { createScalarConfigPromoter } from "./_scalar.ts";

export const M11_PROMOTER = createScalarConfigPromoter({
  moduleCode: "M11",
  description:
    "Promote dining/dietary configuration discovered during Facility Launch.",
  table: "facility_dining_config",
  fields: ["mealSchedule", "dietarySource", "diningOwner"],
  summaryLabel: "Dining configuration",
});
