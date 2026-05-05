export const onboardingIntakeCatalog = {
  M5: {
    priority: "Core launch data",
    purpose: "Build the live resident census so every workflow knows who lives in the building, where they live, who is responsible for them, and what risk/care flags matter.",
    fields: [
      { key: "censusDate", label: "Census effective date", type: "date", sampleValue: "2026-05-01" },
      { key: "residentSource", label: "Resident source of truth", sampleValue: "Current census spreadsheet + face-sheet binder" },
      { key: "residentValidationOwner", label: "Resident validation owner", sampleValue: "Business Office Manager" }
    ],
    checklist: ["Active resident roster", "Room/bed assignment", "Payer and rate link", "Responsible party and emergency contacts", "Physician/pharmacy", "Risk flags and consent/privacy status"],
    collections: [{
      key: "residents",
      label: "Resident roster",
      addLabel: "Add resident",
      requiredFields: ["fullLegalName", "preferredName", "dob", "admissionDate", "status", "roomBed", "payerType", "currentRatePlan", "careLevel", "responsibleParty", "emergencyContact", "primaryPhysician", "pharmacy", "riskFlags", "consentStatus"],
      sampleRecord: { fullLegalName: "Evelyn Carter", preferredName: "Evelyn", dob: "1941-03-14", admissionDate: "2025-08-10", status: "active", roomBed: "101-A", payerType: "private_pay", currentRatePlan: "Assisted Living Base + Level 2 Care", careLevel: "Level 2", responsibleParty: "Mark Carter / son / 205-555-2100", emergencyContact: "Mark Carter 205-555-2100", primaryPhysician: "Dr. Patel", pharmacy: "Homewood Pharmacy", riskFlags: "Fall risk; elopement low", consentStatus: "HIPAA and portal consent on file" },
      fields: [
        { key: "fullLegalName", label: "Full legal name" }, { key: "preferredName", label: "Preferred name" }, { key: "dob", label: "DOB", type: "date" }, { key: "admissionDate", label: "Admission date", type: "date" }, { key: "status", label: "Status" }, { key: "roomBed", label: "Room/bed" }, { key: "payerType", label: "Payer type" }, { key: "currentRatePlan", label: "Current rate plan" }, { key: "careLevel", label: "Care level" }, { key: "responsibleParty", label: "Responsible party" }, { key: "emergencyContact", label: "Emergency contact" }, { key: "primaryPhysician", label: "Primary physician" }, { key: "pharmacy", label: "Pharmacy" }, { key: "riskFlags", label: "Risk flags" }, { key: "consentStatus", label: "Consent/privacy status" }
      ]
    }]
  },
  M6: {
    priority: "Core financial data",
    purpose: "Capture what each resident is charged, who pays, when billing starts, and what exceptions affect revenue accuracy.",
    fields: [
      { key: "billingSystemSource", label: "Billing source of truth", sampleValue: "QuickBooks/customer ledger" },
      { key: "billingCycle", label: "Billing cycle", sampleValue: "Monthly in advance on the 1st" },
      { key: "rateApprovalOwner", label: "Rate approval owner", sampleValue: "CFO" }
    ],
    checklist: ["Resident-level rate schedule", "Payer and billing contact", "Effective dates", "Care-level and add-on charges", "Deposits/concessions/balances", "Collections/escalation rules"],
    collections: [{
      key: "rateRecords",
      label: "Resident rate records",
      addLabel: "Add rate record",
      requiredFields: ["residentId", "payerType", "billingContact", "baseMonthlyRate", "careLevelCharge", "otherCharges", "effectiveDate", "depositBalance", "concessions", "collectionStatus"],
      sampleRecord: { residentName: "Evelyn Carter", payerType: "private_pay", billingContact: "Mark Carter / mark@example.com", baseMonthlyRate: "4200", careLevelCharge: "650", otherCharges: "Medication management 250", effectiveDate: "2026-05-01", depositBalance: "0", concessions: "None", collectionStatus: "current" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" }, { key: "payerType", label: "Payer type" }, { key: "billingContact", label: "Billing contact" }, { key: "baseMonthlyRate", label: "Base monthly rate", type: "number" }, { key: "careLevelCharge", label: "Care charge", type: "number" }, { key: "otherCharges", label: "Other charges" }, { key: "effectiveDate", label: "Effective date", type: "date" }, { key: "depositBalance", label: "Deposit/balance" }, { key: "concessions", label: "Concessions" }, { key: "collectionStatus", label: "Collection status" }
      ]
    }]
  },
  M7: {
    priority: "Clinical operating model",
    purpose: "Define how care levels, assessments, ADLs, service plans, and escalation rules become operational inside the app.",
    fields: [
      { key: "assessmentTool", label: "Assessment tool/source", sampleValue: "AL assessment packet and service plan binder" },
      { key: "reassessmentCadence", label: "Reassessment cadence", sampleValue: "Upon change of condition and quarterly" },
      { key: "carePlanOwner", label: "Care plan owner", sampleValue: "DON / Resident Care Director" }
    ],
    checklist: ["Care level definitions", "ADL support needs", "Resident-specific service plans", "Assessment cadence", "Change-of-condition escalation", "Charge mapping to rates"],
    collections: [{
      key: "carePlans",
      label: "Care/service plans",
      addLabel: "Add care plan",
      requiredFields: ["residentId", "careLevel", "adlNeeds", "mobility", "cognitiveStatus", "fallRisk", "servicePlanSummary", "assessmentDate", "nextReviewDate", "escalationRules"],
      sampleRecord: { residentName: "Evelyn Carter", careLevel: "Level 2", adlNeeds: "Bathing assistance; medication reminders", mobility: "Walker with standby assist", cognitiveStatus: "Mild memory support", fallRisk: "High", servicePlanSummary: "AM/PM ADL prompts; nightly safety check", assessmentDate: "2026-04-20", nextReviewDate: "2026-07-20", escalationRules: "Notify DON after any fall or missed med pass" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" }, { key: "careLevel", label: "Care level" }, { key: "adlNeeds", label: "ADL needs" }, { key: "mobility", label: "Mobility" }, { key: "cognitiveStatus", label: "Cognitive status" }, { key: "fallRisk", label: "Fall risk" }, { key: "servicePlanSummary", label: "Service plan summary" }, { key: "assessmentDate", label: "Assessment date", type: "date" }, { key: "nextReviewDate", label: "Next review", type: "date" }, { key: "escalationRules", label: "Escalation rules" }
      ]
    }]
  },
  M8: {
    priority: "Daily execution model",
    purpose: "Capture the actual rounds/check cadence by shift, resident group, exception, and escalation path so the app reflects reality instead of policy fiction.",
    fields: [
      { key: "roundingPolicySource", label: "Rounds policy/source", sampleValue: "Policy binder + DON interview" },
      { key: "roundingDecisionOwner", label: "Cadence decision owner", sampleValue: "COO" },
      { key: "roundingExceptionProcess", label: "Rounds exception process", sampleValue: "DON approves enhanced checks and documents reason" }
    ],
    checklist: ["Day/evening/night cadence", "Resident-specific enhanced checks", "Shift handoff expectations", "Missed-round escalation", "Policy vs reality reconciliation", "App reminder template"],
    collections: [{
      key: "roundSchedules",
      label: "Rounds/check schedules",
      addLabel: "Add rounds schedule",
      requiredFields: ["roundName", "residentGroup", "shift", "cadence", "startTime", "endTime", "taskList", "documentationRequired", "missedRoundEscalation", "ownerRole"],
      sampleRecord: { roundName: "Memory Care Night Comfort Rounds", residentGroup: "Memory-care wing", shift: "Night", cadence: "Every 60 minutes", startTime: "22:00", endTime: "06:00", taskList: "Safety, toileting, hydration, door check", documentationRequired: "Every completed round in app", missedRoundEscalation: "Notify charge caregiver then DON after 15 minutes", ownerRole: "Night shift lead" },
      fields: [
        { key: "roundName", label: "Round name" }, { key: "residentGroup", label: "Resident group" }, { key: "shift", label: "Shift" }, { key: "cadence", label: "Cadence" }, { key: "startTime", label: "Start" }, { key: "endTime", label: "End" }, { key: "taskList", label: "Task list" }, { key: "documentationRequired", label: "Documentation required" }, { key: "missedRoundEscalation", label: "Missed-round escalation" }, { key: "ownerRole", label: "Owner role" }
      ]
    }]
  },
  M9: {
    priority: "Staffing execution",
    purpose: "Translate staffing, shifts, departments, assignments, call-offs, and coverage rules into operational configuration.",
    fields: [
      { key: "scheduleSource", label: "Schedule source of truth", sampleValue: "Current staff schedule spreadsheet" },
      { key: "staffingRatioPolicy", label: "Staffing ratio policy", sampleValue: "Minimum 2 caregivers days/evenings; 1 awake overnight plus on-call" },
      { key: "callOffOwner", label: "Call-off escalation owner", sampleValue: "Executive Director" }
    ],
    checklist: ["Shift definitions", "Department coverage", "Assignments", "Call-off escalation", "On-call contacts", "Credential restrictions"],
    collections: [{
      key: "shiftTemplates",
      label: "Shift/assignment templates",
      addLabel: "Add shift template",
      requiredFields: ["shiftName", "department", "startTime", "endTime", "minimumStaff", "assignmentPattern", "credentialNeeded", "callOffProcess", "onCallBackup"],
      sampleRecord: { shiftName: "Day Caregiver", department: "Resident Care", startTime: "06:00", endTime: "14:00", minimumStaff: "3", assignmentPattern: "North hall / South hall / Floater", credentialNeeded: "Caregiver orientation complete", callOffProcess: "Call ED and scheduler 4 hours before shift", onCallBackup: "ED then DON" },
      fields: [
        { key: "shiftName", label: "Shift name" }, { key: "department", label: "Department" }, { key: "startTime", label: "Start" }, { key: "endTime", label: "End" }, { key: "minimumStaff", label: "Minimum staff", type: "number" }, { key: "assignmentPattern", label: "Assignment pattern" }, { key: "credentialNeeded", label: "Credential needed" }, { key: "callOffProcess", label: "Call-off process" }, { key: "onCallBackup", label: "On-call backup" }
      ]
    }]
  },
  M10: {
    priority: "Scope-dependent clinical risk",
    purpose: "Determine medication scope and capture pharmacy, MAR/eMAR, med-pass times, exceptions, and controlled-substance process where applicable.",
    fields: [
      { key: "medicationScope", label: "Medication scope", sampleValue: "Medication assistance and reminders; no skilled nursing administration" },
      { key: "marSource", label: "MAR/eMAR source", sampleValue: "Paper MAR binder / pharmacy printout" },
      { key: "medicationOwner", label: "Medication process owner", sampleValue: "DON" }
    ],
    checklist: ["Medication scope decision", "Pharmacy source", "MAR/eMAR source", "Med-pass times", "PRN workflow", "Controlled substance process", "Exception/escalation rules"],
    collections: [{
      key: "medicationProfiles",
      label: "Medication process profiles",
      addLabel: "Add medication profile",
      requiredFields: ["residentId", "pharmacy", "marStatus", "medPassTimes", "prnProcess", "controlledSubstanceProcess", "allergies", "exceptionEscalation"],
      sampleRecord: { residentName: "Evelyn Carter", pharmacy: "Homewood Pharmacy", marStatus: "Paper MAR active", medPassTimes: "08:00, 14:00, 20:00", prnProcess: "Document reason/result and notify nurse/DON per policy", controlledSubstanceProcess: "Double-count at shift change", allergies: "Penicillin", exceptionEscalation: "Missed med escalates to DON immediately" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" }, { key: "pharmacy", label: "Pharmacy" }, { key: "marStatus", label: "MAR status" }, { key: "medPassTimes", label: "Med-pass times" }, { key: "prnProcess", label: "PRN process" }, { key: "controlledSubstanceProcess", label: "Controlled substance process" }, { key: "allergies", label: "Allergies" }, { key: "exceptionEscalation", label: "Exception escalation" }
      ]
    }]
  },
  M11: {
    priority: "Resident experience + safety",
    purpose: "Capture meal schedules, dietary restrictions, allergies, texture orders, hydration/snacks, and dining documentation needs.",
    fields: [
      { key: "mealSchedule", label: "Meal schedule", sampleValue: "Breakfast 8:00, lunch 12:00, dinner 17:00" },
      { key: "dietarySource", label: "Dietary source of truth", sampleValue: "Dietary binder and physician orders" },
      { key: "diningOwner", label: "Dining owner", sampleValue: "Dining Manager" }
    ],
    checklist: ["Meal times", "Allergies", "Diet orders", "Texture/thickened liquids", "Snacks/hydration", "Dining assistance", "Missed meal escalation"],
    collections: [{
      key: "dietaryProfiles",
      label: "Resident dietary profiles",
      addLabel: "Add dietary profile",
      requiredFields: ["residentId", "dietOrder", "allergies", "texture", "likesDislikes", "assistanceNeeded", "snackHydrationPlan", "missedMealEscalation"],
      sampleRecord: { residentName: "Evelyn Carter", dietOrder: "Regular low sodium", allergies: "Shellfish", texture: "Regular texture", likesDislikes: "Likes oatmeal; dislikes fish", assistanceNeeded: "Cueing and tray setup", snackHydrationPlan: "PM snack and hydration rounds", missedMealEscalation: "Notify caregiver lead if meal refused" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" }, { key: "dietOrder", label: "Diet order" }, { key: "allergies", label: "Allergies" }, { key: "texture", label: "Texture" }, { key: "likesDislikes", label: "Likes/dislikes" }, { key: "assistanceNeeded", label: "Assistance needed" }, { key: "snackHydrationPlan", label: "Snack/hydration plan" }, { key: "missedMealEscalation", label: "Missed meal escalation" }
      ]
    }]
  },
  M12: {
    priority: "Engagement model",
    purpose: "Capture activity calendar, resident preferences, attendance tracking, transport/offsite rules, and family-visible engagement data.",
    fields: [
      { key: "activityCalendarSource", label: "Activity calendar source", sampleValue: "Monthly life-enrichment calendar" },
      { key: "attendanceTrackingRule", label: "Attendance tracking rule", sampleValue: "Track attendance for every scheduled group activity" },
      { key: "activitiesOwner", label: "Activities owner", sampleValue: "Life Enrichment Director" }
    ],
    checklist: ["Calendar", "Resident interests", "Attendance", "Transport/offsite rules", "Supplies/volunteers", "Family visibility"],
    collections: [{
      key: "activityPlans",
      label: "Activity/engagement plans",
      addLabel: "Add activity plan",
      requiredFields: ["activityName", "schedule", "residentAudience", "owner", "attendanceRequired", "supplies", "transportOffsiteRules", "familyVisibility"],
      sampleRecord: { activityName: "Morning Exercise", schedule: "Mon/Wed/Fri 10:00", residentAudience: "All AL residents", owner: "Life Enrichment Director", attendanceRequired: "Yes", supplies: "Chairs, music speaker", transportOffsiteRules: "N/A onsite", familyVisibility: "Show on family calendar" },
      fields: [
        { key: "activityName", label: "Activity" }, { key: "schedule", label: "Schedule" }, { key: "residentAudience", label: "Audience" }, { key: "owner", label: "Owner" }, { key: "attendanceRequired", label: "Attendance required" }, { key: "supplies", label: "Supplies" }, { key: "transportOffsiteRules", label: "Transport/offsite rules" }, { key: "familyVisibility", label: "Family visibility" }
      ]
    }]
  },
  M13: {
    priority: "Physical plant operations",
    purpose: "Capture rooms/assets, work-order categories, preventive maintenance, vendors, emergency maintenance, and life-safety dependencies.",
    fields: [
      { key: "workOrderSource", label: "Work-order source/process", sampleValue: "Maintenance logbook and verbal requests" },
      { key: "preventiveMaintenanceCadence", label: "Preventive maintenance cadence", sampleValue: "Monthly life-safety checks; quarterly room audit" },
      { key: "maintenanceOwner", label: "Maintenance owner", sampleValue: "Maintenance Director" }
    ],
    checklist: ["Room/assets", "Work-order categories", "Preventive maintenance", "Emergency maintenance", "Life-safety equipment", "Vendor escalation"],
    collections: [{
      key: "maintenanceAssets",
      label: "Maintenance assets / PM items",
      addLabel: "Add maintenance item",
      requiredFields: ["assetName", "location", "category", "pmCadence", "lastServiceDate", "nextDueDate", "vendorOrOwner", "emergencyProcedure"],
      sampleRecord: { assetName: "Fire panel", location: "Main lobby", category: "Life safety", pmCadence: "Monthly inspection / annual vendor service", lastServiceDate: "2026-04-01", nextDueDate: "2026-05-01", vendorOrOwner: "SafeFire Systems", emergencyProcedure: "Call vendor and ED immediately on fault" },
      fields: [
        { key: "assetName", label: "Asset" }, { key: "location", label: "Location" }, { key: "category", label: "Category" }, { key: "pmCadence", label: "PM cadence" }, { key: "lastServiceDate", label: "Last service", type: "date" }, { key: "nextDueDate", label: "Next due", type: "date" }, { key: "vendorOrOwner", label: "Vendor/owner" }, { key: "emergencyProcedure", label: "Emergency procedure" }
      ]
    }]
  },
  M14: {
    priority: "Revenue pipeline",
    purpose: "Capture referral sources, pipeline stages, required pre-admission documents, move-in workflow, deposit rules, and conversion accountability.",
    fields: [
      { key: "crmSource", label: "CRM/pipeline source", sampleValue: "Sales spreadsheet and inquiry log" },
      { key: "moveInChecklistOwner", label: "Move-in checklist owner", sampleValue: "Sales Director / Business Office" },
      { key: "admissionApprovalRule", label: "Admission approval rule", sampleValue: "ED + DON approval before move-in date is confirmed" }
    ],
    checklist: ["Inquiry/referral sources", "Pipeline stages", "Pre-admit assessment", "Required documents", "Deposit and move-in fees", "Room assignment", "Move-in day workflow"],
    collections: [{
      key: "admissionsPipeline",
      label: "Admissions pipeline records",
      addLabel: "Add admission record",
      requiredFields: ["prospectName", "referralSource", "stage", "targetMoveInDate", "responsibleSalesOwner", "assessmentStatus", "requiredDocsStatus", "depositStatus", "roomTarget", "nextAction"],
      sampleRecord: { prospectName: "Robert Allen", referralSource: "Hospital discharge planner", stage: "Assessment scheduled", targetMoveInDate: "2026-05-15", responsibleSalesOwner: "Sales Director", assessmentStatus: "DON assessment pending", requiredDocsStatus: "Face sheet and physician orders requested", depositStatus: "Not collected", roomTarget: "112", nextAction: "Complete assessment and rate quote" },
      fields: [
        { key: "prospectName", label: "Prospect" }, { key: "referralSource", label: "Referral source" }, { key: "stage", label: "Stage" }, { key: "targetMoveInDate", label: "Target move-in", type: "date" }, { key: "responsibleSalesOwner", label: "Sales owner" }, { key: "assessmentStatus", label: "Assessment status" }, { key: "requiredDocsStatus", label: "Required docs" }, { key: "depositStatus", label: "Deposit" }, { key: "roomTarget", label: "Room target" }, { key: "nextAction", label: "Next action" }
      ]
    }]
  },
  M15: {
    priority: "Family/responsible-party access",
    purpose: "Capture family contacts, legal authority, portal invitations, communication preferences, billing access, and privacy/consent boundaries.",
    fields: [
      { key: "familyPortalScope", label: "Family portal scope", sampleValue: "Responsible-party updates, statements, activity visibility, care communications" },
      { key: "communicationPolicy", label: "Communication policy", sampleValue: "Primary responsible party receives billing and care escalations" },
      { key: "portalOwner", label: "Portal rollout owner", sampleValue: "Business Office Manager" }
    ],
    checklist: ["Responsible party", "Emergency contacts", "POA/authority", "Communication preference", "Portal invite status", "Billing access", "HIPAA/privacy consent"],
    collections: [{
      key: "familyContacts",
      label: "Family/responsible-party contacts",
      addLabel: "Add family contact",
      requiredFields: ["residentId", "contactName", "relationship", "phone", "email", "authority", "communicationPreference", "portalInviteStatus", "billingAccess", "privacyConsent"],
      sampleRecord: { residentName: "Evelyn Carter", contactName: "Mark Carter", relationship: "Son / responsible party", phone: "205-555-2100", email: "mark@example.com", authority: "Financial POA on file", communicationPreference: "Text urgent, email routine", portalInviteStatus: "Invite pending", billingAccess: "Yes", privacyConsent: "HIPAA release on file" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" }, { key: "contactName", label: "Contact" }, { key: "relationship", label: "Relationship" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "authority", label: "Authority" }, { key: "communicationPreference", label: "Communication preference" }, { key: "portalInviteStatus", label: "Portal invite status" }, { key: "billingAccess", label: "Billing access" }, { key: "privacyConsent", label: "Privacy consent" }
      ]
    }]
  },
  M16: {
    priority: "Risk and compliance operating model",
    purpose: "Capture incidents, reportability, claims/legal routing, investigation ownership, and trend visibility before launch.",
    fields: [
      { key: "incidentPolicySource", label: "Incident policy/source", sampleValue: "Incident binder and state reporting policy" },
      { key: "claimsRoutingOwner", label: "Claims/legal routing owner", sampleValue: "CFO / Legal" },
      { key: "stateReportingRule", label: "State reporting rule", sampleValue: "Reportable incidents escalated to ED/DON immediately for state threshold decision" }
    ],
    checklist: ["Incident categories", "Severity levels", "State reporting threshold", "Family notification", "Claims/legal routing", "Investigation workflow", "Trend dashboard"],
    collections: [{
      key: "incidentWorkflows",
      label: "Incident/risk workflows",
      addLabel: "Add incident workflow",
      requiredFields: ["incidentType", "severityRule", "immediateActions", "familyNotificationRule", "stateReportingThreshold", "claimsRouting", "investigationOwner", "followUpCadence"],
      sampleRecord: { incidentType: "Fall with injury", severityRule: "Major/reportability review", immediateActions: "Assess resident, call EMS if needed, notify DON/ED", familyNotificationRule: "Notify responsible party same day", stateReportingThreshold: "ED/DON determine state report requirement", claimsRouting: "CFO/legal if injury or hospital transfer", investigationOwner: "DON", followUpCadence: "24h, 72h, care-plan review" },
      fields: [
        { key: "incidentType", label: "Incident type" }, { key: "severityRule", label: "Severity rule" }, { key: "immediateActions", label: "Immediate actions" }, { key: "familyNotificationRule", label: "Family notification" }, { key: "stateReportingThreshold", label: "State reporting threshold" }, { key: "claimsRouting", label: "Claims/legal routing" }, { key: "investigationOwner", label: "Investigation owner" }, { key: "followUpCadence", label: "Follow-up cadence" }
      ]
    }]
  },
  M18: {
    priority: "External dependency map",
    purpose: "Capture vendors, emergency contacts, utilities, service agreements, after-hours routing, and operational dependencies.",
    fields: [
      { key: "vendorSource", label: "Vendor/contact source", sampleValue: "Vendor binder and emergency contact sheet" },
      { key: "afterHoursVendorRule", label: "After-hours vendor rule", sampleValue: "ED approves emergency calls; maintenance calls life-safety vendors directly" },
      { key: "vendorOwner", label: "Vendor directory owner", sampleValue: "Maintenance Director / Business Office" }
    ],
    checklist: ["Vendor directory", "Utilities", "Emergency services", "After-hours process", "Contracts/renewals", "Insurance requirements", "Account numbers"],
    collections: [{
      key: "vendorContacts",
      label: "Vendor and emergency contacts",
      addLabel: "Add vendor/contact",
      requiredFields: ["organization", "category", "primaryContact", "phone", "afterHoursPhone", "accountNumber", "contractStatus", "insuranceRequired", "escalationOwner"],
      sampleRecord: { organization: "SafeFire Systems", category: "Fire/life safety", primaryContact: "Dispatch", phone: "205-555-3000", afterHoursPhone: "205-555-3999", accountNumber: "HF-7781", contractStatus: "Active annual service", insuranceRequired: "COI required annually", escalationOwner: "Maintenance Director" },
      fields: [
        { key: "organization", label: "Organization" }, { key: "category", label: "Category" }, { key: "primaryContact", label: "Primary contact" }, { key: "phone", label: "Phone" }, { key: "afterHoursPhone", label: "After-hours phone" }, { key: "accountNumber", label: "Account #" }, { key: "contractStatus", label: "Contract status" }, { key: "insuranceRequired", label: "Insurance required" }, { key: "escalationOwner", label: "Escalation owner" }
      ]
    }]
  },
  M19: {
    priority: "Executive operating visibility",
    purpose: "Define the dashboards, KPIs, owners, cadence, and launch success metrics executives need to run the facility after go-live.",
    fields: [
      { key: "executiveDashboardAudience", label: "Dashboard audience", sampleValue: "CEO, CFO, COO, ED, DON" },
      { key: "reportCadence", label: "Report cadence", sampleValue: "Daily launch huddle; weekly executive rollup" },
      { key: "kpiOwner", label: "KPI owner", sampleValue: "COO" }
    ],
    checklist: ["Census", "Occupancy", "Revenue/rates", "Incidents", "Staffing", "Rounds completion", "Med/diet exceptions", "Admissions pipeline", "Open work orders", "Launch success criteria"],
    collections: [{
      key: "kpiDefinitions",
      label: "Dashboard/KPI definitions",
      addLabel: "Add KPI definition",
      requiredFields: ["kpiName", "businessQuestion", "dataSource", "owner", "refreshCadence", "target", "launchThreshold", "audience", "actionIfOffTrack"],
      sampleRecord: { kpiName: "Rounds completion", businessQuestion: "Are required resident checks completed on time?", dataSource: "App rounds logs", owner: "DON", refreshCadence: "Daily", target: "98% complete", launchThreshold: "95% for first 14 days", audience: "COO, ED, DON", actionIfOffTrack: "Huddle review and assignment correction" },
      fields: [
        { key: "kpiName", label: "KPI" }, { key: "businessQuestion", label: "Business question" }, { key: "dataSource", label: "Data source" }, { key: "owner", label: "Owner" }, { key: "refreshCadence", label: "Refresh cadence" }, { key: "target", label: "Target" }, { key: "launchThreshold", label: "Launch threshold" }, { key: "audience", label: "Audience" }, { key: "actionIfOffTrack", label: "Action if off-track" }
      ]
    }]
  }
};

export const fullIntakeModuleCodes = Object.keys(onboardingIntakeCatalog);

export function createEmptyIntakeData(spec) {
  const data = {};
  for (const field of spec.fields || []) data[field.key] = field.defaultValue || "";
  for (const collection of spec.collections || []) data[collection.key] = [];
  return data;
}
