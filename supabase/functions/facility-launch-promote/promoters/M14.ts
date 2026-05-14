import { createScalarConfigPromoter } from "./_scalar.ts";

export const M14_PROMOTER = createScalarConfigPromoter({
  moduleCode: "M14",
  description:
    "Promote admissions and move-in configuration discovered during Facility Launch.",
  table: "facility_admissions_config",
  fields: ["crmSource", "moveInChecklistOwner", "admissionApprovalRule"],
  summaryLabel: "Admissions configuration",
});
