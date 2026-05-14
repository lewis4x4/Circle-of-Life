import { createScalarConfigPromoter } from "./_scalar.ts";

export const M6_PROMOTER = createScalarConfigPromoter({
  moduleCode: "M6",
  description:
    "Promote resident billing/rate configuration discovered during Facility Launch.",
  table: "facility_billing_config",
  fields: [
    "billingSystemSource",
    "billingCycle",
    "rateApprovalOwner",
    "postedPrivateRoomRate",
    "postedCompanionRoomRate",
    "medicaidProviderRule",
  ],
  summaryLabel: "Billing configuration",
});
