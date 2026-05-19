// ---- src/intakeCatalog.js ----
const onboardingIntakeCatalog = {
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
    purpose: "Capture the real contracted rate for each resident. COL does not use generic tiers: each resident can have a negotiated private amount, an optional Medicaid provider amount, and a posted-rate cap.",
    guidanceCards: [
      {
        title: "No tier model",
        body: "Do not enter Level 1 / Level 2 rate tiers unless a specific resident contract uses that language. COL confirmed rates are negotiated resident-by-resident."
      },
      {
        title: "Medicaid rule",
        body: "For Medicaid residents, capture the resident contracted private amount plus the Medicaid provider amount. The total cannot exceed the posted room rate for that room type."
      }
    ],
    fields: [
      { key: "billingSystemSource", label: "Billing source of truth", sampleValue: "QuickBooks/customer ledger + resident contract" },
      { key: "billingCycle", label: "Billing cycle / billing rule", sampleValue: "Monthly; individually negotiated under posted ceilings" },
      { key: "rateApprovalOwner", label: "Rate approval owner", sampleValue: "CFO / Business Office" },
      { key: "postedPrivateRoomRate", label: "Posted private room rate", type: "number", sampleValue: "5550" },
      { key: "postedCompanionRoomRate", label: "Posted companion room rate", type: "number", sampleValue: "4000" },
      { key: "medicaidProviderRule", label: "Medicaid provider rule", type: "textarea", sampleValue: "Provider amount cascades by facility/provider and combines with resident contracted private amount, capped at posted rate." }
    ],
    checklist: ["Posted private and companion rates", "Resident contracted private amount", "Medicaid provider, if applicable", "Provider amount by facility", "Posted-rate cap check", "Billing contact and payer", "Effective dates", "Deposits/concessions/balances", "Collections/escalation rules"],
    collections: [{
      key: "rateRecords",
      label: "Resident rate records",
      addLabel: "Add resident rate",
      requiredFields: ["residentId", "roomType", "payerType", "billingContact", "contractedPrivateAmount", "medicaidProvider", "medicaidProviderAmount", "postedRateCap", "effectiveDate", "depositBalance", "concessions", "collectionStatus"],
      sampleRecord: { residentName: "Evelyn Carter", roomType: "Companion", payerType: "Medicaid + private responsibility", billingContact: "Mark Carter / mark@example.com", contractedPrivateAmount: "1500", medicaidProvider: "Sunshine LTC", medicaidProviderAmount: "2500", postedRateCap: "4000", effectiveDate: "2026-05-01", depositBalance: "0", concessions: "None", collectionStatus: "current" },
      fields: [
        { key: "residentId", label: "Resident", relation: "resident" },
        { key: "roomType", label: "Room type", type: "select", options: ["Private", "Companion"] },
        { key: "payerType", label: "Payer type", type: "select", options: ["Private pay", "Medicaid + private responsibility", "Medicaid only", "VA / Aid & Attendance", "LTC insurance", "Other"] },
        { key: "billingContact", label: "Billing contact" },
        { key: "contractedPrivateAmount", label: "Contracted private amount", type: "number" },
        { key: "medicaidProvider", label: "Medicaid provider", type: "select", options: ["None", "United", "Humana", "Sunshine LTC", "Sunshine MMA", "Other"] },
        { key: "medicaidProviderAmount", label: "Provider amount", type: "number" },
        { key: "postedRateCap", label: "Posted rate cap", type: "number" },
        { key: "effectiveDate", label: "Effective date", type: "date" },
        { key: "depositBalance", label: "Deposit/balance" },
        { key: "concessions", label: "Concessions" },
        { key: "collectionStatus", label: "Collection status" }
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
    priority: "Family access and communication rules",
    purpose: "Capture exactly who can receive updates for each resident, what legal authority they have, what they can see in the family portal, whether billing access is allowed, and whether privacy consent is on file.",
    guidanceCards: [
      {
        title: "How to complete this module",
        body: "Start with the resident from M5, then add each responsible party, POA, emergency contact, or family contact as a separate row. Do not type a resident name manually."
      },
      {
        title: "What good looks like",
        body: "For every resident, staff know who to call, what that person is allowed to know, whether they can see billing, and whether the portal invite is active."
      },
      {
        title: "Common miss",
        body: "Do not give billing or health information access just because someone is family. The row must show authority and privacy consent."
      }
    ],
    fields: [
      {
        key: "familyPortalScope",
        label: "What can family members see in the portal?",
        placeholder: "Example: Statements, activity calendar, wellness updates, messages; no clinical notes unless approved",
        help: "This is the facility-wide default. Each contact row can still be more restrictive.",
        sampleValue: "Responsible-party updates, statements, activity visibility, care communications"
      },
      {
        key: "communicationPolicy",
        label: "What is our rule for who gets called for what?",
        type: "textarea",
        placeholder: "Example: Primary responsible party gets billing and care escalations. Secondary contact gets care escalations only if primary cannot be reached.",
        help: "This is the standing communication policy, not a one-off note.",
        sampleValue: "Primary responsible party receives billing and care escalations"
      },
      {
        key: "portalOwner",
        label: "Who owns portal rollout and invite cleanup?",
        placeholder: "Example: Business Office Manager",
        help: "One person must chase missing emails, failed invites, consent gaps, and billing-access questions.",
        sampleValue: "Business Office Manager"
      }
    ],
    checklist: ["Resident selected from M5", "Responsible party identified", "Emergency contact identified", "Legal authority recorded", "Communication preference recorded", "Portal invite status known", "Billing access decision made", "Privacy/HIPAA consent status known"],
    collections: [{
      key: "familyContacts",
      label: "Resident family and responsible-party access rules",
      addLabel: "Add family/responsible-party contact",
      emptyState: "No family or responsible-party contacts yet. Staff will not know who can receive updates, who has legal authority, who can access billing, or who should be invited to the portal until these rows are entered.",
      requiredFields: ["residentId", "contactName", "relationship", "phone", "email", "authority", "communicationPreference", "portalInviteStatus", "billingAccess", "privacyConsent"],
      sampleRecord: { residentName: "Evelyn Carter", contactName: "Mark Carter", relationship: "Son / responsible party", phone: "205-555-2100", email: "mark@example.com", authority: "Financial POA on file", communicationPreference: "Text urgent, email routine", portalInviteStatus: "Invite pending", billingAccess: "Yes", privacyConsent: "HIPAA release on file" },
      fields: [
        { key: "residentId", label: "Which resident is this contact connected to?", columnLabel: "Resident", relation: "resident", help: "This pulls from M5 so the contact maps to the correct resident record." },
        { key: "contactName", label: "Contact full name", columnLabel: "Contact" },
        { key: "relationship", label: "Relationship to resident", columnLabel: "Relationship", type: "select", options: ["Responsible party", "Son", "Daughter", "Spouse", "Sibling", "Friend", "Guardian", "Financial POA", "Healthcare POA", "Other"] },
        { key: "phone", label: "Best phone number", columnLabel: "Phone" },
        { key: "email", label: "Email for portal invite", columnLabel: "Email" },
        { key: "authority", label: "What legal authority does this person have?", columnLabel: "Authority", type: "select", options: ["Financial POA on file", "Healthcare POA on file", "Guardian / conservator", "Responsible party agreement", "Emergency contact only", "No formal authority", "Pending document", "Other — explain"] },
        { key: "communicationPreference", label: "How should we contact them?", columnLabel: "Contact preference", type: "select", options: ["Call for urgent issues", "Text urgent / email routine", "Email routine only", "Portal message only", "Call first, then text", "Do not contact except emergency"] },
        { key: "portalInviteStatus", label: "Portal invite status", columnLabel: "Portal", type: "select", options: ["Not invited", "Invite pending", "Invite sent", "Active", "Declined", "Locked / disabled"] },
        { key: "billingAccess", label: "Can this person see billing?", columnLabel: "Billing", type: "yesNo", help: "Turn this off unless they have financial authority or the resident authorized it." },
        { key: "privacyConsent", label: "Privacy/HIPAA consent status", columnLabel: "Privacy", type: "select", options: ["HIPAA release on file", "Limited release on file", "Consent pending", "No consent", "Not applicable"] }
      ]
    }]
  },
  M16: {
    priority: "What happens when something goes wrong",
    purpose: "Configure how the facility will respond to future incidents in the app. This is not a log of past incidents; it defines the response templates staff will follow after go-live.",
    guidanceCards: [
      {
        title: "How to complete this module",
        body: "Use one row per incident type. These are future response templates, not past incident records. Pick the closest option first, then add who, when, and what happens next."
      },
      {
        title: "What good looks like",
        body: "A brand-new caregiver can tell what to do in the first 15 minutes, who to notify, whether ED/DON/CFO/legal must review, and when the incident is considered closed."
      },
      {
        title: "Common miss",
        body: "Do not enter only yes/no or vague words like 'notify family' or 'review'. Write the timing and accountable role."
      }
    ],
    fields: [
      {
        key: "incidentPolicySource",
        label: "Where does our written incident policy live today?",
        placeholder: "Example: Operations binder, incident policy tab + state reporting policy",
        help: "We need a source we can cite if surveyors, families, insurers, or attorneys ask how incidents are handled.",
        sampleValue: "Incident binder and state reporting policy"
      },
      {
        key: "claimsRoutingOwner",
        label: "Who decides whether to call insurance, broker, or attorney?",
        placeholder: "Example: ED triages first; CFO owns claim notice; outside counsel for litigation risk",
        help: "Enter one accountable person or role, not a department.",
        sampleValue: "CFO / Legal"
      },
      {
        key: "stateReportingRule",
        label: "What is our standing rule for notifying the state?",
        type: "textarea",
        placeholder: "Example: DON + ED review every major/critical incident within 2 hours; default-yes for abuse, elopement, death, EMS/hospitalization.",
        help: "This is the plain-English policy. Each incident row below captures the case-by-case workflow.",
        sampleValue: "Reportable incidents escalated to ED/DON immediately for state threshold decision"
      }
    ],
    checklist: [
      "Incident types staff must report",
      "What makes an event minor, major, or critical",
      "What staff do in the first 15 minutes",
      "When family/responsible party must be notified",
      "When ED/DON review state reporting",
      "When CFO/broker/legal must be notified",
      "Who investigates and closes follow-up"
    ],
    collections: [{
      key: "incidentWorkflows",
      label: "Incident response workflow templates",
      addLabel: "Add incident response rule",
      emptyState: "No incident response rules yet. Staff will not know what to do after falls, elopements, medication errors, allegations, injuries, or claims until these rules are entered.",
      requiredFields: ["incidentType", "severityRule", "immediateActions", "familyNotificationRule", "stateReportingThreshold", "claimsRouting", "investigationOwner", "followUpCadence"],
      sampleRecord: {
        incidentType: "Fall with injury",
        severityRule: "Major — injury, ER visit, or family-level concern",
        immediateActions: "Assess resident, vitals, first aid, call EMS if indicated, notify charge nurse and DON, secure scene, start incident note.",
        familyNotificationRule: "Same shift — within 2 hours",
        stateReportingThreshold: "Maybe — ED/DON decide within 24 hours",
        claimsRouting: "CFO if hospital transfer or possible liability",
        investigationOwner: "DON",
        followUpCadence: "24h + 72h + care-plan review"
      },
      fields: [
        {
          key: "incidentType",
          label: "What kind of incident is this?",
          columnLabel: "Incident",
          type: "select",
          options: [
            "Fall — no injury",
            "Fall with injury",
            "Elopement / missing resident",
            "Medication error",
            "Abuse / neglect / exploitation allegation",
            "Resident-to-resident altercation",
            "Skin tear / wound / pressure injury",
            "Choking / aspiration",
            "Behavioral event",
            "Hospital transfer / emergency transport",
            "Property loss or damage",
            "Other — explain in actions"
          ],
          help: "Pick the closest event type. The app uses this to branch the workflow."
        },
        {
          key: "severityRule",
          label: "How serious is this event at worst?",
          columnLabel: "Severity",
          type: "select",
          options: [
            "Minor — no injury, routine follow-up",
            "Major — injury, ER visit, hospital transfer, or family-level concern",
            "Critical — abuse allegation, elopement, death, life-safety risk, or immediate state/legal concern"
          ],
          help: "If unsure between major and critical, choose critical and escalate."
        },
        {
          key: "immediateActions",
          label: "What must staff do in the first 15 minutes?",
          columnLabel: "First 15 min",
          type: "textarea",
          placeholder: "Example: Assess resident, take vitals, call EMS if indicated, notify charge nurse/DON, secure scene, start incident note.",
          help: "Write the play-by-play a new caregiver should follow before the issue gets handed off."
        },
        {
          key: "familyNotificationRule",
          label: "When do we notify family or responsible party?",
          columnLabel: "Family timing",
          type: "select",
          options: [
            "Immediately — within 1 hour",
            "Same shift — within 2 hours",
            "Same day — before end of day",
            "Within 24 hours",
            "Only if condition changes",
            "Per care plan / responsible-party preference",
            "Not applicable"
          ],
          help: "Family means the responsible party/contact captured in M15, not whoever happens to call first."
        },
        {
          key: "stateReportingThreshold",
          label: "Does ED/DON need to review state reporting?",
          columnLabel: "State review",
          type: "select",
          options: [
            "Yes — always for this category",
            "Maybe — ED/DON decide within 24 hours",
            "Only if injury, EMS, hospital transfer, allegation, elopement, or death",
            "No — not reportable under normal circumstances"
          ],
          help: "If the answer depends on facts, choose Maybe so it becomes an ED/DON review item."
        },
        {
          key: "claimsRouting",
          label: "When do we loop in CFO, insurance broker, or legal?",
          columnLabel: "Claims/legal",
          type: "select",
          options: [
            "CFO if hospital transfer or possible liability",
            "Insurance broker for any potential claim",
            "Outside counsel for allegations, litigation threat, or serious injury",
            "ED/DON review first, then decide",
            "No routine claims/legal routing",
            "Case-by-case — explain in actions"
          ],
          help: "This is not software routing; it is who gets contacted when the event could become a claim or legal issue."
        },
        {
          key: "investigationOwner",
          label: "Who investigates and closes the loop?",
          columnLabel: "Investigation owner",
          type: "select",
          options: ["DON", "Executive Director", "Risk / Compliance lead", "Regional Clinical", "DON + ED jointly", "Outside investigator", "Other — name role in actions"],
          help: "Pick one accountable owner. Do not enter 'team'."
        },
        {
          key: "followUpCadence",
          label: "When do we check back until this is closed?",
          columnLabel: "Follow-up",
          type: "select",
          options: [
            "End of shift only",
            "24 hours",
            "24h + 72h",
            "24h + 72h + care-plan review",
            "Daily until resolved",
            "Weekly trend review",
            "Event-specific — explain in actions"
          ],
          help: "This becomes the follow-up task rhythm after the initial incident note."
        }
      ]
    }]
  },
  M18: {
    priority: "Who we call when the building needs outside help",
    purpose: "Capture the outside companies, emergency services, utilities, account numbers, after-hours phone numbers, contract status, insurance requirements, and escalation owners needed to keep the facility running.",
    guidanceCards: [
      {
        title: "Those checklist pills are not buttons",
        body: "They are the categories that must be covered: vendors, utilities, emergency services, contracts, insurance, and account numbers. The table below is where the actual contacts go."
      },
      {
        title: "The 2 a.m. test",
        body: "If a pipe bursts, fire panel alarms, phone system fails, or HVAC dies at 2 a.m., this module should tell staff exactly who to call and who escalates."
      },
      {
        title: "Common miss",
        body: "Office phone numbers are not enough. Capture the after-hours dispatch number, account number, contract status, COI status, and internal owner."
      }
    ],
    fields: [
      {
        key: "vendorSource",
        label: "Where is the vendor list today?",
        type: "select",
        options: ["Binder", "Spreadsheet", "Accounting/vendor system", "Sticky notes / not centralized", "Mixed", "Unknown"],
        help: "Be honest. This tells us how hard the migration will be.",
        sampleValue: "Vendor binder and emergency contact sheet"
      },
      {
        key: "afterHoursVendorRule",
        label: "Who is allowed to call vendors after hours?",
        type: "textarea",
        placeholder: "Example: Maintenance on-call calls life-safety vendors directly. ED approval required for non-emergency vendor spend over $500.",
        help: "This prevents staff from guessing during emergencies.",
        sampleValue: "ED approves emergency calls; maintenance calls life-safety vendors directly"
      },
      {
        key: "vendorOwner",
        label: "Who owns vendor directory accuracy?",
        placeholder: "Example: Maintenance Director, with Business Office backup",
        help: "One owner must update phone numbers, contracts, account numbers, COIs, and renewals.",
        sampleValue: "Maintenance Director / Business Office"
      }
    ],
    checklist: ["Vendor directory", "Utilities", "Emergency services", "After-hours process", "Contracts/renewals", "Insurance requirements", "Account numbers"],
    collections: [{
      key: "vendorContacts",
      label: "Vendor, utility, and emergency contacts",
      addLabel: "Add vendor / utility / emergency contact",
      emptyState: "No vendor or emergency contacts yet. Staff will not know who to call for fire/life-safety, HVAC, plumbing, utilities, pharmacy, legal, insurance, or after-hours failures until these rows are entered.",
      requiredFields: ["organization", "category", "primaryContact", "phone", "afterHoursPhone", "accountNumber", "contractStatus", "insuranceRequired", "escalationOwner"],
      sampleRecord: { organization: "SafeFire Systems", category: "Fire/life safety", primaryContact: "Dispatch", phone: "205-555-3000", afterHoursPhone: "205-555-3999", accountNumber: "HF-7781", contractStatus: "Active annual service", insuranceRequired: "COI required annually", escalationOwner: "Maintenance Director" },
      fields: [
        { key: "organization", label: "Company / agency name", columnLabel: "Organization" },
        { key: "category", label: "What kind of outside help is this?", columnLabel: "Category", type: "select", options: ["Fire / life safety", "HVAC", "Plumbing", "Electrical", "Pest control", "Landscaping", "Pharmacy", "Medical waste", "Lab / imaging", "Food / supply", "IT / phones", "Generator / fuel", "Insurance broker", "Outside counsel", "Utility", "Emergency services", "Other"] },
        { key: "primaryContact", label: "Primary contact or dispatch name", columnLabel: "Primary contact" },
        { key: "phone", label: "Normal business-hours phone", columnLabel: "Phone" },
        { key: "afterHoursPhone", label: "24/7 or after-hours phone", columnLabel: "After-hours", help: "This is the number staff need when the office is closed." },
        { key: "accountNumber", label: "Account or customer number", columnLabel: "Account #" },
        { key: "contractStatus", label: "Contract status", columnLabel: "Contract", type: "select", options: ["Active", "Auto-renew", "Expiring within 90 days", "Expired", "Month-to-month", "No contract on file", "Unknown"] },
        { key: "insuranceRequired", label: "Vendor COI status — do they owe us a certificate of insurance?", columnLabel: "Vendor COI", type: "select", options: ["Required and current", "Required but expired", "Required but missing", "Not required", "Pending request", "Unknown"] },
        { key: "escalationOwner", label: "Who escalates if vendor does not respond?", columnLabel: "Escalation owner" }
      ]
    }]
  },
  M19: {
    priority: "Executive go-live visibility",
    purpose: "Lock the short list of numbers leadership will check every day for the first 30 days, who owns each number, where it comes from, and what we do when it slips. This is the launch scoreboard — not a BI spec. If a number isn't on this list, no one will look at it during go-live.",
    guidanceCards: [
      {
        title: "Plain-English translation",
        body: "This module asks: what numbers will the CEO/CFO/COO/ED/DON watch every morning after go-live, and who fixes it when a number turns red? It records targets and owners; automated live alerts are configured in the production system after launch."
      },
      {
        title: "What good looks like",
        body: "Each row has a number, why it matters, where it comes from, a named owner, a daily/weekly cadence, a target, and the action if it slips."
      },
      {
        title: "Common miss",
        body: "Do not enter broad topics like 'staffing' or 'revenue'. Enter a measurable number like 'open shifts today' or 'private-pay AR over 30 days'."
      }
    ],
    fields: [
      { key: "executiveDashboardAudience", label: "Who reviews these numbers?", placeholder: "Example: CEO, CFO, COO, ED, DON", help: "List the people or roles in the daily launch huddle.", sampleValue: "CEO, CFO, COO, ED, DON" },
      { key: "reportCadence", label: "How often will leadership review them?", type: "select", options: ["Daily 9am huddle for first 30 days", "Daily by 8am email", "Weekly executive rollup", "Monthly operating review", "Custom — explain in KPI rows"], help: "Daily is the normal launch cadence for the first 30 days.", sampleValue: "Daily 9am huddle for first 30 days; weekly executive rollup after that" },
      { key: "kpiOwner", label: "Who owns assembling the scoreboard?", placeholder: "Example: COO — assembles the daily scoreboard and chases gaps", help: "One owner compiles the numbers and follows up when data is missing.", sampleValue: "COO — assembles the daily scoreboard and chases gaps" }
    ],
    checklist: [
      "At least one resident-safety number (e.g., rounds completion, incidents)",
      "At least one census/occupancy number",
      "At least one revenue or billing-health number",
      "At least one staffing-coverage number",
      "At least one admissions/move-in pipeline number",
      "Each number has a single named owner (not a department)",
      "Each number has a documented source (system, log, or person)",
      "Each number has both a day-1-to-30 floor and a steady-state target",
      "Each number has a written action for when it slips",
      "Daily review cadence and reviewer roster confirmed for the first 30 days"
    ],
    collections: [{
      key: "kpiDefinitions",
      label: "Numbers leadership will watch at go-live",
      addLabel: "Add scoreboard number",
      emptyState: "No scoreboard numbers yet. Leadership cannot run a useful go-live huddle until safety, census, revenue, staffing, admissions, and operating-risk numbers have owners, sources, targets, and actions.",
      requiredFields: ["kpiName", "businessQuestion", "dataSource", "owner", "refreshCadence", "target", "launchThreshold", "actionIfOffTrack"],
      sampleRecord: {
        kpiName: "Rounds completion %",
        businessQuestion: "Are required resident checks happening on time? Missed rounds = safety + survey risk.",
        dataSource: "App rounds log, exported each morning by night-shift lead",
        owner: "DON — Maria Hayes",
        refreshCadence: "Refreshed every morning by 8am",
        target: "≥ 98% rounds completed on time",
        launchThreshold: "≥ 95% for the first 14 days, then re-baseline",
        audience: "COO, ED, DON on the daily huddle",
        actionIfOffTrack: "DON pulls the assignment sheet at huddle, reassigns, documents reason in app"
      },
      fields: [
        { key: "kpiName", label: "What number are we watching?", columnLabel: "Number" },
        { key: "businessQuestion", label: "Why does this number matter?", columnLabel: "Why it matters", type: "textarea" },
        { key: "dataSource", label: "Where does the number come from?", columnLabel: "Source" },
        { key: "owner", label: "Who is on the hook for this number?", columnLabel: "Owner" },
        { key: "refreshCadence", label: "How often is it updated?", columnLabel: "Cadence", type: "select", options: ["Live", "Hourly", "Daily by 8am", "Daily by end of day", "Weekly Monday 9am", "Monthly", "Manual during launch huddle"] },
        { key: "target", label: "What is the steady-state target after day 30?", columnLabel: "Target", help: "The normal operating goal after launch stabilizes." },
        { key: "launchThreshold", label: "What is the launch floor before we call it red?", columnLabel: "Launch floor", help: "The temporary acceptable bar during the first 14–30 days." },
        { key: "audience", label: "Who sees this number?", columnLabel: "Audience" },
        { key: "actionIfOffTrack", label: "What do we do if it slips?", columnLabel: "Action if red", type: "textarea", help: "Use a verb and an owner, not vague words like review or investigate." }
      ]
    }]
  }};
const fullIntakeModuleCodes = Object.keys(onboardingIntakeCatalog);
function createEmptyIntakeData(spec) {
  const data = {};
  for (const field of spec.fields || []) data[field.key] = field.defaultValue || "";
  for (const collection of spec.collections || []) data[collection.key] = [];
  return data;
}

// ---- src/seedData.js ----
const STORAGE_KEY = "facilityLaunchCenter.homewood.v5";

const nowIso = new Date().toISOString();
const moduleCatalog = [
  { moduleNumber: 1, moduleCode: "M1", moduleName: "Company / Portfolio", isMvpDetailed: true },
  { moduleNumber: 2, moduleCode: "M2", moduleName: "Facility Profile", isMvpDetailed: true },
  { moduleNumber: 3, moduleCode: "M3", moduleName: "Rooms / Beds / Units", isMvpDetailed: true },
  { moduleNumber: 4, moduleCode: "M4", moduleName: "Employees / Users / Roles", isMvpDetailed: true },
  { moduleNumber: 5, moduleCode: "M5", moduleName: "Residents", isMvpDetailed: true },
  { moduleNumber: 6, moduleCode: "M6", moduleName: "Resident Rates / Billing / Payer", isMvpDetailed: true },
  { moduleNumber: 7, moduleCode: "M7", moduleName: "Care Levels / Service Plans / ADLs", isMvpDetailed: true },
  { moduleNumber: 8, moduleCode: "M8", moduleName: "Rounds / Checks / Care Tasks", isMvpDetailed: true },
  { moduleNumber: 9, moduleCode: "M9", moduleName: "Schedules / Shifts / Assignments", isMvpDetailed: true },
  { moduleNumber: 10, moduleCode: "M10", moduleName: "Medications (scope-dependent)", isMvpDetailed: true },
  { moduleNumber: 11, moduleCode: "M11", moduleName: "Dining / Meals / Dietary", isMvpDetailed: true },
  { moduleNumber: 12, moduleCode: "M12", moduleName: "Activities / Life Enrichment", isMvpDetailed: true },
  { moduleNumber: 13, moduleCode: "M13", moduleName: "Maintenance / Work Orders / Assets", isMvpDetailed: true },
  { moduleNumber: 14, moduleCode: "M14", moduleName: "Admissions / Sales / Move-In Pipeline", isMvpDetailed: true },
  { moduleNumber: 15, moduleCode: "M15", moduleName: "Family / Responsible-Party Portal", isMvpDetailed: true },
  { moduleNumber: 16, moduleCode: "M16", moduleName: "Incidents / Risk / Claims Awareness", isMvpDetailed: true },
  { moduleNumber: 17, moduleCode: "M17", moduleName: "Documents / Insurance / Compliance", isMvpDetailed: true },
  { moduleNumber: 18, moduleCode: "M18", moduleName: "Vendors / Contacts / Emergency", isMvpDetailed: true },
  { moduleNumber: 19, moduleCode: "M19", moduleName: "Launch Scoreboard / Operating Reports", isMvpDetailed: true }
];

const emptyOperationalIntakeData = Object.fromEntries(
  fullIntakeModuleCodes.map((code) => [code, createEmptyIntakeData(onboardingIntakeCatalog[code])])
);


const emptyModules = moduleCatalog.map((m) => ({
  ...m,
  scopeStatus: "in",
  ownerName: "",
  ownerTitle: "",
  source: "",
  dueDate: "",
  openQuestions: "",
  status: "not_started",
  nextAction: "Attach a Homewood ingestion source or mark as a Round 2 gap."
}));
const emptyOnboardingState = {
  program: {
    id: "prog-homewood-mvp",
    name: "Homewood Facility Launch MVP",
    sponsor: "",
    deputySponsor: "",
    cfo: "",
    coo: "",
    onboarder: "",
    documentCustodian: "",
    definitionOfLive: "",
    homewoodScope: "Homewood Lodge ALF launch in scope; real onboarding data will be loaded from the Homewood ingestion manifest.",
    thresholds: { moduleReadinessTarget: 95, staleMonths: 12, gate2FacilityScoreTarget: 90 },
    createdAt: nowIso
  },
  facility: {
    id: "fac-homewood",
    programId: "prog-homewood-mvp",
    name: "Homewood Lodge ALF",
    status: "onboarding",
    pilotWarnings: [],
    linkedEntityIds: []
  },
  modules: emptyModules,
  mvpData: {
    M1: {
      parentLegalName: "",
      dba: "",
      operatingLlc: "",
      propertyLlc: "",
      mailingAddress: "",
      corporateContact: "",
      billingContact: "",
      timeZone: "America/New_York",
      legalEntities: [],
      ambiguityCandidates: []
    },
    M2: {
      legalName: "",
      dba: "Homewood Lodge ALF",
      facilityType: "Assisted Living Facility",
      licenseNumber: "",
      licenseState: "Florida",
      licenseAgency: "AHCA",
      licenseExpiration: "",
      physicalAddress: "",
      facilityAddress: "",
      mailingAddress: "",
      mainPhone: "",
      afterHoursPhone: "",
      capacity: "",
      floorsWings: "",
      executiveDirector: "",
      don: "",
      maintenanceDirector: "",
      businessOfficeManager: "",
      emergencyContact: "",
      operatingAddressConfirmed: false
    },
    M3: {
      rooms: [],
      bedsTotal: null,
      unitsTotal: null
    },
    M4: {
      employees: [],
      roleCoverageNotes: ""
    },
    ...emptyOperationalIntakeData,
    M17: {
      ...emptyOperationalIntakeData.M17,
      reviewNotes: ""
    }
  },
  documents: [],
  documentGroups: [],
  gates: [
    { code: "G0", name: "Program Charter", status: "not_started", blockers: ["Complete Program Charter from real onboarding sources"], requiredSignerRole: "Executive Sponsor" },
    { code: "G2", name: "Owner + Intake Readiness", status: "blocked", blockers: ["Load and validate Homewood ingestion manifest"], requiredSignerRole: "Executive Sponsor / COO" }
  ],
  exceptions: [],
  contradictions: [],
  decisionLog: [
    {
      id: "dec-empty-onboarding-shell",
      timestamp: nowIso,
      actor: "system",
      actionType: "empty_onboarding_initialized",
      summary: "Initialized empty Homewood onboarding shell; real data must come from the Homewood ingestion manifest.",
      relatedType: "facility",
      relatedId: "fac-homewood"
    }
  ]
};

// ---- src/documentIntelligence.js ----
const ARTIFACT_RULES = [
  { artifactType: "state_license", group: "License", modules: ["M2", "M17"], patterns: [/license|licensure|state/i] },
  { artifactType: "gl_cert", group: "General Liability", modules: ["M17"], patterns: [/\bgl\b|general\s+liability|liability\s+cert|certificate\s+of\s+liability/i] },
  { artifactType: "property_policy", group: "Property Policy", modules: ["M17"], patterns: [/property.*policy|policy.*property/i] },
  { artifactType: "property_insurance", group: "Property Insurance", modules: ["M17"], patterns: [/evidence.*property|commercial\s+property|property\s+insurance/i] },
  { artifactType: "bond_certificate", group: "Bond Certificate", modules: ["M17"], patterns: [/bond/i] },
  { artifactType: "loss_run", group: "Loss Run", modules: ["M16", "M17"], patterns: [/loss\s*run|claims?\s+history|claim/i] },
  { artifactType: "floor_plan", group: "Floor Plan", modules: ["M3", "M17"], patterns: [/floor\s*plan|room\s*map|unit\s*map/i] },
  { artifactType: "emergency_plan", group: "Emergency Plan", modules: ["M16", "M18", "M17"], patterns: [/emergency|evacuation|disaster/i] },
  { artifactType: "vendor_agreement", group: "Vendor Agreement", modules: ["M18", "M17"], patterns: [/vendor|agreement|contract|service/i] }
];

const FACILITY_RULES = [
  { pattern: /homewood/i, facility: "Homewood Lodge ALF" },
  { pattern: /oakridge/i, facility: "Oakridge" },
  { pattern: /rising\s*oaks/i, facility: "Rising Oaks" },
  { pattern: /grand\s*cypress/i, facility: "Grand Cypress" },
  { pattern: /pinehouse/i, facility: "Pinehouse" }
];

function cleanBaseName(fileName = "") {
  return String(fileName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text = "") {
  return cleanBaseName(text).replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstYear(text = "") {
  const match = String(text).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function dateFor(year, month = 1, day = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currencyFromExpiration(expirationDate) {
  if (!expirationDate) return "unknown";
  const expiration = new Date(`${expirationDate}T23:59:59`);
  if (Number.isNaN(expiration.getTime())) return "unknown";
  const now = new Date();
  if (expiration < now) return "stale";
  const daysUntilExpiration = (expiration.getTime() - now.getTime()) / 86400000;
  return daysUntilExpiration <= 90 ? "aging" : "fresh";
}

function detectArtifact(fileName) {
  for (const rule of ARTIFACT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(fileName))) return rule;
  }
  return { artifactType: "other", group: "Other Document", modules: ["M17"], patterns: [] };
}

function detectFacility(fileName) {
  return FACILITY_RULES.find((rule) => rule.pattern.test(fileName))?.facility || "Homewood Lodge ALF";
}

function confidenceFor(rule, year) {
  if (rule.artifactType !== "other" && year) return "high";
  if (rule.artifactType !== "other") return "medium";
  return "low";
}
function inferDocumentIntelligence(fileName = "", existing = {}) {
  const sourceName = String(fileName || existing.title || existing.originalFilename || "").trim();
  const baseTitle = cleanBaseName(existing.title || sourceName || "Uploaded document");
  const rule = detectArtifact(sourceName || baseTitle);
  const year = firstYear(sourceName || baseTitle);
  const facility = existing.entityAssociation || existing.facilityName || detectFacility(sourceName || baseTitle);
  const effectiveDate = existing.effectiveDate || (year ? dateFor(year) : "");
  const expirationDate = existing.expirationDate || (year && rule.artifactType !== "loss_run" ? dateFor(year + 1) : "");
  const term = existing.term || (year ? `${year} ${rule.group}` : rule.group);
  const currencyStatus = existing.currencyStatus || currencyFromExpiration(expirationDate);
  const confidence = existing.confidence || confidenceFor(rule, year);
  const documentGroupId = existing.documentGroupId || `grp-${rule.artifactType}-${facility.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${year || "unknown"}`;
  const groupName = existing.groupName || `${facility} ${year || "Current"} ${rule.group}`;
  const mappedModuleCodes = existing.mappedModuleCodes || rule.modules;

  return {
    title: existing.title || titleCase(baseTitle || sourceName),
    artifactType: existing.artifactType || rule.artifactType,
    entityAssociation: facility,
    facilityName: facility,
    term,
    effectiveDate,
    expirationDate,
    currencyStatus,
    version: existing.version || "v1",
    custodianApprovalStatus: existing.custodianApprovalStatus || "pending",
    confidence,
    documentGroupId,
    groupName,
    mappedModuleCodes,
    automationSummary: `Auto-classified as ${rule.group}; routed to ${mappedModuleCodes.join(", ")}; ${currencyStatus === "stale" ? "needs refreshed document or exception" : "ready for custodian review"}.`,
    notes: existing.notes || `Auto-detected from filename. ${year ? `Detected term year ${year}.` : "No year detected; confirm term/dates."}`
  };
}

// ---- src/state.js ----
let memoryFallback = null;

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function readStorage() {
  try {
    if (typeof localStorage === "undefined") return memoryFallback;
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Facility Launch Center storage read failed; using in-memory fallback.", error);
    return memoryFallback;
  }
}

function persist(state) {
  const serialized = JSON.stringify(state);
  memoryFallback = serialized;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.warn("Facility Launch Center storage write failed; continuing with in-memory fallback.", error);
  }
}

function withSaved(state) {
  persist(state);
  return state;
}

function isBlankForSeedMerge(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function seededRecordKey(record) {
  if (!record || typeof record !== "object") return "";
  return record.id || record.roomNumber || record.roundName || record.kpiName || record.organization || record.fullLegalName || record.contactName || "";
}

function isLegacyDemoState(state) {
  if (!state || typeof state !== "object") return false;
  const documentIds = new Set((state.documents || []).map((document) => document?.id).filter(Boolean));
  const hasSeedDecision = (state.decisionLog || []).some((entry) => entry?.id === "dec-seed-1" || /Seeded Homewood pilot fixture/i.test(entry?.summary || ""));
  const hasSeedDocuments = documentIds.has("doc-gl-1") || documentIds.has("doc-prop-1");
  return hasSeedDecision || hasSeedDocuments;
}

function mergeMissingSeedValues(current, seed) {
  if (isBlankForSeedMerge(current)) return clone(seed);
  if (Array.isArray(current) && Array.isArray(seed)) {
    const next = clone(current);
    const existingKeys = new Set(next.map(seededRecordKey).filter(Boolean));
    for (const seedRecord of seed) {
      const key = seededRecordKey(seedRecord);
      if (key && !existingKeys.has(key)) {
        next.push(clone(seedRecord));
        existingKeys.add(key);
      }
    }
    return next;
  }
  if (
    current && seed
    && typeof current === "object"
    && typeof seed === "object"
    && !Array.isArray(current)
    && !Array.isArray(seed)
  ) {
    const next = clone(current);
    for (const [key, seedValue] of Object.entries(seed)) {
      next[key] = mergeMissingSeedValues(next[key], seedValue);
    }
    return next;
  }
  return current;
}
function loadState() {
  const raw = readStorage();
  if (!raw) return resetState();
  try {
    const parsed = JSON.parse(raw);
    if (isLegacyDemoState(parsed)) return resetState();
    return withSaved(mergeMissingSeedValues(parsed, emptyOnboardingState));
  } catch (error) {
    console.warn("Facility Launch Center storage parse failed; resetting onboarding shell.", error);
    return resetState();
  }
}
function saveState(state) {
  return withSaved(state);
}
function resetState() {
  const empty = clone(emptyOnboardingState);
  return withSaved(empty);
}
function appendDecisionLog(state, entry) {
  const next = clone(state);
  next.decisionLog = next.decisionLog || [];
  next.decisionLog.unshift({
    id: `dec-${Date.now()}-${next.decisionLog.length}`,
    timestamp: new Date().toISOString(),
    actor: entry.actor || "user",
    actionType: entry.actionType || "note",
    summary: entry.summary || "Decision log entry",
    relatedType: entry.relatedType || "general",
    relatedId: entry.relatedId || "",
    snapshot: entry.snapshot || null
  });
  return withSaved(next);
}
function updateProgramField(state, field, value) {
  const next = clone(state);
  next.program = next.program || {};
  next.program[field] = value;
  return appendDecisionLog(next, {
    actionType: "program_charter_updated",
    summary: `Updated Program Charter field ${field}`,
    relatedType: "program",
    relatedId: next.program.id || "program"
  });
}
function updateProgramThreshold(state, field, value) {
  const next = clone(state);
  next.program = next.program || {};
  next.program.thresholds = next.program.thresholds || {};
  const numeric = Number(value);
  next.program.thresholds[field] = Number.isFinite(numeric) ? numeric : value;
  return appendDecisionLog(next, {
    actionType: "program_threshold_updated",
    summary: `Updated readiness threshold ${field}`,
    relatedType: "program",
    relatedId: next.program.id || "program"
  });
}
function updateOwnerWorksheetRow(state, moduleCode, patch) {
  const next = clone(state);
  const row = (next.modules || []).find((m) => m.moduleCode === moduleCode);
  if (!row) return state;
  Object.assign(row, patch);
  return appendDecisionLog(next, {
    actionType: "owner_assignment_updated",
    summary: `Updated owner worksheet row ${moduleCode}`,
    relatedType: "module",
    relatedId: moduleCode
  });
}

function normalizeMvpFieldValue(moduleCode, field, value) {
  if (moduleCode === "M3" && (field === "bedsTotal" || field === "unitsTotal")) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const numberValue = Number(text);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  return value;
}
function updateMvpDataField(state, moduleCode, field, value) {
  const next = clone(state);
  next.mvpData = next.mvpData || {};
  next.mvpData[moduleCode] = next.mvpData[moduleCode] || {};
  next.mvpData[moduleCode][field] = normalizeMvpFieldValue(moduleCode, field, value);
  return withSaved(next);
}
function addM3Room(state, roomInput) {
  const payload = typeof roomInput === "object" && roomInput !== null ? roomInput : { roomNumber: roomInput };
  const roomNumber = String(payload.roomNumber || payload.name || "").trim();
  if (!roomNumber) return state;
  const next = clone(state);
  next.mvpData.M3 = next.mvpData.M3 || {};
  next.mvpData.M3.rooms = next.mvpData.M3.rooms || [];
  next.mvpData.M3.rooms.push({
    id: `room-${Date.now()}-${next.mvpData.M3.rooms.length}`,
    roomNumber,
    floor: String(payload.floor || "").trim(),
    wing: String(payload.wing || "").trim(),
    unitType: String(payload.unitType || "").trim(),
    bedCount: Number(payload.bedCount) || 0,
    careDesignation: String(payload.careDesignation || "").trim(),
    status: String(payload.status || "active").trim(),
    bedDesignation: String(payload.bedDesignation || "").trim(),
    name: roomNumber
  });
  return withSaved(next);
}
function addM4Employee(state, employeeInput, roleInput = "") {
  const payload = typeof employeeInput === "object" && employeeInput !== null
    ? employeeInput
    : { fullLegalName: employeeInput, jobTitle: roleInput, appRole: roleInput };
  const fullLegalName = String(payload.fullLegalName || payload.name || "").trim();
  const appRole = String(payload.appRole || payload.role || "").trim();
  if (!fullLegalName || !appRole) return state;
  const next = clone(state);
  next.mvpData.M4 = next.mvpData.M4 || {};
  next.mvpData.M4.employees = next.mvpData.M4.employees || [];
  next.mvpData.M4.employees.push({
    id: `emp-${Date.now()}-${next.mvpData.M4.employees.length}`,
    fullLegalName,
    preferredName: String(payload.preferredName || "").trim(),
    emailOrMobile: String(payload.emailOrMobile || payload.email || payload.mobile || "").trim(),
    hireDate: String(payload.hireDate || "").trim(),
    employmentStatus: String(payload.employmentStatus || payload.status || "active").trim(),
    jobTitle: String(payload.jobTitle || payload.role || "").trim(),
    appRole,
    primaryFacility: String(payload.primaryFacility || "Homewood Lodge ALF").trim(),
    shiftDepartment: String(payload.shiftDepartment || payload.department || "").trim(),
    supervisor: String(payload.supervisor || "").trim(),
    credentialSummary: String(payload.credentialSummary || "").trim(),
    loginStatus: String(payload.loginStatus || "pending").trim(),
    name: fullLegalName,
    role: appRole
  });
  return withSaved(next);
}
function addModuleRecord(state, moduleCode, collectionKey, payload) {
  const code = String(moduleCode || "").trim();
  const key = String(collectionKey || "").trim();
  if (!code || !key || typeof payload !== "object" || payload === null) return state;

  const cleaned = Object.fromEntries(
    Object.entries(payload).map(([field, value]) => [field, String(value ?? "").trim()])
  );
  const hasContent = Object.values(cleaned).some((value) => String(value || "").trim());
  if (!hasContent) return state;

  const next = clone(state);
  next.mvpData = next.mvpData || {};
  next.mvpData[code] = next.mvpData[code] || {};
  next.mvpData[code][key] = Array.isArray(next.mvpData[code][key]) ? next.mvpData[code][key] : [];
  next.mvpData[code][key].push({
    id: `${code.toLowerCase()}-${key}-${Date.now()}-${next.mvpData[code][key].length}`,
    ...cleaned
  });

  return appendDecisionLog(next, {
    actionType: "module_intake_record_added",
    summary: `Added ${code} ${key} intake record`,
    relatedType: "module",
    relatedId: code
  });
}
function updateModuleRecord(state, moduleCode, collectionKey, recordId, patch) {
  const code = String(moduleCode || "").trim();
  const key = String(collectionKey || "").trim();
  const id = String(recordId || "").trim();
  if (!code || !key || !id || typeof patch !== "object" || patch === null) return state;

  const next = clone(state);
  const rows = next.mvpData?.[code]?.[key];
  if (!Array.isArray(rows)) return state;
  const row = rows.find((candidate) => String(candidate.id || "") === id);
  if (!row) return state;

  Object.assign(row, Object.fromEntries(
    Object.entries(patch).map(([field, value]) => [field, String(value ?? "").trim()])
  ));

  return appendDecisionLog(next, {
    actionType: "module_intake_record_updated",
    summary: `Updated ${code} ${key} intake record`,
    relatedType: "module",
    relatedId: code
  });
}
function deleteModuleRecord(state, moduleCode, collectionKey, recordId) {
  const code = String(moduleCode || "").trim();
  const key = String(collectionKey || "").trim();
  const id = String(recordId || "").trim();
  if (!code || !key || !id) return state;

  const next = clone(state);
  const rows = next.mvpData?.[code]?.[key];
  if (!Array.isArray(rows)) return state;
  const before = rows.length;
  next.mvpData[code][key] = rows.filter((candidate) => String(candidate.id || "") !== id);
  if (next.mvpData[code][key].length === before) return state;

  return appendDecisionLog(next, {
    actionType: "module_intake_record_deleted",
    summary: `Deleted ${code} ${key} intake record`,
    relatedType: "module",
    relatedId: code
  });
}
function addDocument(state, payload) {
  const title = String(payload.title || payload.fileName || payload.originalFilename || "").trim();
  if (!title) return state;
  const intelligence = inferDocumentIntelligence(payload.fileName || payload.originalFilename || title, payload);
  const next = clone(state);
  next.documents = next.documents || [];
  next.documentGroups = next.documentGroups || [];
  const id = payload.id || `doc-${Date.now()}-${next.documents.length}`;
  const groupId = intelligence.documentGroupId || payload.documentGroupId || `grp-${id}`;
  const doc = {
    id,
    title: intelligence.title || title,
    originalFilename: payload.originalFilename || payload.fileName || title,
    artifactType: intelligence.artifactType || "other",
    documentGroupId: groupId,
    isSourceOfTruth: Boolean(payload.isSourceOfTruth),
    currencyStatus: intelligence.currencyStatus || "unknown",
    facilityId: payload.facilityId || "fac-homewood",
    facilityName: intelligence.facilityName || "Homewood Lodge ALF",
    entityAssociation: intelligence.entityAssociation || "",
    effectiveDate: intelligence.effectiveDate || "",
    expirationDate: intelligence.expirationDate || "",
    term: intelligence.term || "",
    version: intelligence.version || "v1",
    custodianApprovalStatus: intelligence.custodianApprovalStatus || "pending",
    confidence: intelligence.confidence || "manual",
    notes: intelligence.notes || "",
    mappedModuleCodes: intelligence.mappedModuleCodes || ["M17"],
    automationSummary: intelligence.automationSummary || "",
    uploadedAt: new Date().toISOString()
  };
  next.documents.unshift(doc);

  let group = next.documentGroups.find((candidate) => candidate.id === groupId);
  if (!group) {
    group = {
      id: groupId,
      name: intelligence.groupName || payload.groupName || `${title} group`,
      artifactType: doc.artifactType,
      documentIds: [],
      sourceOfTruthDocumentId: null
    };
    next.documentGroups.push(group);
  }
  if (!group.documentIds.includes(id)) group.documentIds.push(id);
  if (doc.isSourceOfTruth) group.sourceOfTruthDocumentId = id;

  return appendDecisionLog(next, {
    actionType: "document_intake_added",
    summary: `Added document intake row ${title}`,
    relatedType: "document",
    relatedId: id
  });
}
function updateDocument(state, documentId, patch) {
  const next = clone(state);
  const doc = (next.documents || []).find((candidate) => candidate.id === documentId);
  if (!doc) return state;
  Object.assign(doc, patch);
  return appendDecisionLog(next, {
    actionType: "document_metadata_updated",
    summary: `Updated document metadata for ${doc.title}`,
    relatedType: "document",
    relatedId: documentId
  });
}
function deleteDocument(state, documentId) {
  const id = String(documentId || "").trim();
  if (!id) return state;
  const next = clone(state);
  const before = (next.documents || []).length;
  const doc = (next.documents || []).find((candidate) => candidate.id === id);
  next.documents = (next.documents || []).filter((candidate) => candidate.id !== id);
  if (next.documents.length === before) return state;
  next.documentGroups = (next.documentGroups || []).map((group) => {
    const documentIds = (group.documentIds || []).filter((candidateId) => candidateId !== id);
    return {
      ...group,
      documentIds,
      sourceOfTruthDocumentId: group.sourceOfTruthDocumentId === id ? null : group.sourceOfTruthDocumentId
    };
  }).filter((group) => (group.documentIds || []).length > 0);

  return appendDecisionLog(next, {
    actionType: "document_intake_deleted",
    summary: `Deleted document intake row ${doc?.title || id}`,
    relatedType: "document",
    relatedId: id
  });
}
function selectSourceOfTruthDocument(state, groupId, documentId) {
  const next = clone(state);
  const group = (next.documentGroups || []).find((g) => g.id === groupId);
  if (!group || !group.documentIds.includes(documentId)) return state;

  group.sourceOfTruthDocumentId = documentId;

  (next.documents || []).forEach((doc) => {
    if (!group.documentIds.includes(doc.id)) return;
    doc.isSourceOfTruth = doc.id === documentId;
  });

  return appendDecisionLog(next, {
    actionType: "source_of_truth_selected",
    summary: `Selected source of truth for ${group.name}`,
    relatedType: "document_group",
    relatedId: groupId,
    snapshot: { groupId, documentId }
  });
}
function routeStaleDocument(state, documentId, ownerName) {
  const next = clone(state);
  const doc = (next.documents || []).find((d) => d.id === documentId);
  if (!doc) return state;
  doc.routedOwnerName = String(ownerName || "").trim();
  return appendDecisionLog(next, {
    actionType: "document_routed",
    summary: `Routed stale document ${doc.title} to ${doc.routedOwnerName || "owner"}`,
    relatedType: "document",
    relatedId: documentId
  });
}
function addException(state, payload) {
  const next = clone(state);
  next.exceptions = next.exceptions || [];
  next.exceptions.unshift({
    id: `exc-${Date.now()}-${next.exceptions.length}`,
    status: "requested",
    createdAt: new Date().toISOString(),
    approverName: "",
    approverRole: "",
    ...payload
  });
  return withSaved(next);
}
function approveException(state, exceptionId, approverName = "", approverRole = "") {
  const next = clone(state);
  const ex = (next.exceptions || []).find((e) => e.id === exceptionId);
  if (!ex) return state;
  ex.status = "approved";
  ex.approvedAt = new Date().toISOString();
  ex.approverName = approverName || ex.approverName || "Approver";
  ex.approverRole = approverRole || ex.approverRole || "Authorized approver";
  return appendDecisionLog(next, {
    actionType: "exception_approved",
    summary: `Approved exception ${exceptionId} by ${ex.approverName} (${ex.approverRole})`,
    relatedType: "exception",
    relatedId: exceptionId,
    snapshot: { approverName: ex.approverName, approverRole: ex.approverRole }
  });
}
function closeException(state, exceptionId) {
  const next = clone(state);
  const ex = (next.exceptions || []).find((e) => e.id === exceptionId);
  if (!ex) return state;
  ex.status = "closed";
  ex.closedAt = new Date().toISOString();
  return withSaved(next);
}
function addContradiction(state, payload) {
  const next = clone(state);
  next.contradictions = next.contradictions || [];
  const created = {
    id: `ctr-${Date.now()}-${next.contradictions.length}`,
    status: "open",
    createdAt: new Date().toISOString(),
    type: "other",
    severity: "major",
    ...payload
  };
  next.contradictions.unshift(created);
  return appendDecisionLog(next, {
    actionType: "contradiction_created",
    summary: created.summary || `Created contradiction ${created.id}`,
    relatedType: "contradiction",
    relatedId: created.id
  });
}
function updateContradiction(state, contradictionId, patch) {
  const next = clone(state);
  const item = (next.contradictions || []).find((c) => c.id === contradictionId);
  if (!item) return state;
  Object.assign(item, patch);
  return appendDecisionLog(next, {
    actionType: "contradiction_updated",
    summary: `Updated contradiction ${contradictionId}`,
    relatedType: "contradiction",
    relatedId: contradictionId
  });
}
function assignContradictionOwner(state, contradictionId, ownerName) {
  return updateContradiction(state, contradictionId, { ownerName: String(ownerName || "").trim() });
}
function resolveContradiction(state, contradictionId, resolutionNotes = "", resolvedBy = "user") {
  const notes = String(resolutionNotes || "").trim();
  const next = clone(state);
  const item = (next.contradictions || []).find((c) => c.id === contradictionId);
  if (!item || !notes) return state;
  item.status = "resolved";
  item.resolutionNotes = notes;
  item.resolvedBy = resolvedBy || "user";
  item.resolvedAt = new Date().toISOString();
  return appendDecisionLog(next, {
    actionType: "contradiction_resolved",
    summary: `Resolved contradiction ${contradictionId}`,
    relatedType: "contradiction",
    relatedId: contradictionId,
    snapshot: { resolutionNotes: notes, resolvedBy: item.resolvedBy }
  });
}
function signGate(state, gateCode, signerName, signerRoleOrEvaluation, maybeEvaluation) {
  const signerRole = maybeEvaluation ? signerRoleOrEvaluation : "Authorized signer";
  const evaluation = maybeEvaluation || signerRoleOrEvaluation;
  const next = clone(state);
  const gate = (next.gates || []).find((g) => g.code === gateCode);
  if (!gate || !evaluation || !evaluation.pass || !String(signerName || "").trim()) return state;

  gate.status = "signed";
  gate.signedBy = String(signerName).trim();
  gate.signedRole = signerRole || gate.requiredSignerRole || "Authorized signer";
  gate.signedAt = new Date().toISOString();
  gate.criteriaSnapshot = {
    pass: evaluation.pass,
    criteria: evaluation.criteria,
    blockers: evaluation.blockers,
    facilityReadinessScore: evaluation.facilityReadinessScore ?? null,
    exceptionsReliedUpon: (next.exceptions || []).filter((exception) => exception.status === "approved")
  };
  gate.blockers = [];

  return appendDecisionLog(next, {
    actionType: "gate_signed",
    summary: `Signed ${gateCode} by ${gate.signedBy} (${gate.signedRole})`,
    relatedType: "gate",
    relatedId: gateCode,
    snapshot: gate.criteriaSnapshot
  });
}

// ---- src/scoring.js ----
const MVP_CODES = new Set(["M1", "M2", "M3", "M4", "M17", ...fullIntakeModuleCodes]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return !isBlank(value);
}

function normalizeScopeId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isExpired(exception) {
  if (!exception?.expiryDate) return false;
  const expiryText = String(exception.expiryDate);
  const expiry = new Date(expiryText.includes("T") ? expiryText : `${expiryText}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() < Date.now();
}
function hasApprovedException(state, scopeType, scopeId) {
  const normalizedScopeType = String(scopeType || "").trim();
  const normalizedScopeId = normalizeScopeId(scopeId);

  return safeArray(state?.exceptions).some((exception) => {
    if (exception.status !== "approved") return false;
    if (exception.scopeType !== normalizedScopeType) return false;
    if (isExpired(exception)) return false;
    return normalizeScopeId(exception.scopeId) === normalizedScopeId;
  });
}
function hasApprovedModuleException(state, module) {
  if (!module) return false;
  return hasApprovedException(state, "module", module.moduleCode)
    || hasApprovedException(state, "module", `M${module.moduleNumber}`)
    || hasApprovedException(state, "module", module.id);
}

function isFiniteNumberLike(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string") return false;
  if (isBlank(value)) return false;
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function pct(checks) {
  if (!checks.length) return 0;
  return checks.filter(Boolean).length / checks.length;
}

function completeRoom(room) {
  return [
    room?.roomNumber || room?.name,
    room?.floor,
    room?.wing,
    room?.unitType,
    isFiniteNumberLike(room?.bedCount),
    room?.careDesignation,
    room?.status
  ].every(Boolean);
}

function completeEmployee(employee) {
  return [
    employee?.fullLegalName || employee?.name,
    employee?.preferredName,
    employee?.emailOrMobile,
    employee?.hireDate,
    employee?.employmentStatus,
    employee?.jobTitle,
    employee?.appRole || employee?.role,
    employee?.primaryFacility,
    employee?.shiftDepartment,
    employee?.supervisor,
    employee?.credentialSummary,
    employee?.loginStatus
  ].every(Boolean);
}

function completeDocumentMetadata(doc) {
  return [
    doc?.title,
    doc?.artifactType,
    doc?.facilityName || doc?.facilityId,
    doc?.entityAssociation,
    doc?.term || doc?.effectiveDate,
    doc?.version,
    doc?.currencyStatus,
    doc?.custodianApprovalStatus,
    doc?.confidence
  ].every(Boolean);
}

function relationTargetExists(state, fieldDef, value) {
  if (!present(value)) return false;
  if (fieldDef?.relation === "resident") {
    return safeArray(state?.mvpData?.M5?.residents).some((resident) => resident.id === value);
  }
  return present(value);
}

function requiredRecordComplete(record, requiredFields = [], fieldDefs = [], state = null) {
  return requiredFields.every((field) => {
    const fieldDef = fieldDefs.find((candidate) => candidate.key === field);
    if (fieldDef?.relation) return relationTargetExists(state, fieldDef, record?.[field]);
    return present(record?.[field]);
  });
}

function getCatalogCompleteness(data, spec, state) {
  const checks = [];
  for (const field of spec.fields || []) checks.push(present(data?.[field.key]));
  for (const collection of spec.collections || []) {
    const rows = safeArray(data?.[collection.key]);
    checks.push(rows.length > 0);
    checks.push(rows.some((row) => requiredRecordComplete(row, collection.requiredFields || [], collection.fields || [], state)));
  }
  return pct(checks);
}
function getIntakeRecordCounts(state) {
  return Object.fromEntries(Object.entries(onboardingIntakeCatalog).map(([code, spec]) => [
    code,
    Object.fromEntries((spec.collections || []).map((collection) => [collection.key, safeArray(state?.mvpData?.[code]?.[collection.key]).length]))
  ]));
}
function moduleHasOwnerCoverage(module) {
  return Boolean(module?.ownerName && module?.source && module?.dueDate);
}
function moduleHasOwnerCoverageOrException(module, state) {
  return moduleHasOwnerCoverage(module) || hasApprovedModuleException(state, module);
}
function getModulesMissingCoverage(modules = [], state = null) {
  return modules.filter((m) => m.scopeStatus !== "out" && !moduleHasOwnerCoverageOrException(m, state));
}
function getUnresolvedDuplicateGroups(state) {
  return safeArray(state?.documentGroups).filter((group) => {
    const hasDuplicates = safeArray(group.documentIds).length > 1;
    return hasDuplicates && !group.sourceOfTruthDocumentId;
  });
}
function getInvalidSourceOfTruthGroups(state) {
  const documents = safeArray(state?.documents);
  return safeArray(state?.documentGroups).filter((group) => {
    const groupIds = safeArray(group.documentIds);
    const members = documents.filter((doc) => groupIds.includes(doc.id));
    const selectedCount = members.filter((doc) => doc.isSourceOfTruth).length;
    const selectedOutsideGroup = Boolean(group.sourceOfTruthDocumentId && !groupIds.includes(group.sourceOfTruthDocumentId));
    const selectedMissingDoc = Boolean(group.sourceOfTruthDocumentId && !documents.some((doc) => doc.id === group.sourceOfTruthDocumentId));
    return selectedCount > 1 || selectedOutsideGroup || selectedMissingDoc;
  });
}
function getStaleDocumentsWithoutApprovedException(state) {
  return safeArray(state?.documents).filter((doc) => {
    if (doc.currencyStatus !== "stale") return false;
    const routed = Boolean(String(doc.routedOwnerName || "").trim());
    return !routed && !hasApprovedException(state, "document", doc.id);
  });
}

function getOpenBlockingContradictions(state) {
  return safeArray(state?.contradictions).filter(
    (c) => c.status === "open" && (c.severity === "blocking" || c.severity === "major")
  );
}

function getMvpCompleteness(state, moduleCode) {
  const data = state?.mvpData?.[moduleCode];
  if (!data || typeof data !== "object") return 0;

  if (moduleCode === "M1") {
    return pct([
      data.parentLegalName,
      data.dba,
      data.operatingLlc,
      data.propertyLlc,
      data.mailingAddress,
      data.corporateContact,
      data.billingContact,
      data.timeZone
    ].map(present));
  }

  if (moduleCode === "M2") {
    return pct([
      data.legalName,
      data.dba,
      data.facilityType,
      data.licenseNumber,
      data.licenseState,
      data.licenseAgency,
      data.licenseExpiration,
      data.physicalAddress || data.facilityAddress,
      data.mailingAddress,
      data.mainPhone,
      data.afterHoursPhone,
      data.capacity,
      data.floorsWings,
      data.executiveDirector,
      data.don,
      data.maintenanceDirector,
      data.businessOfficeManager,
      data.emergencyContact,
      data.operatingAddressConfirmed
    ].map(Boolean));
  }

  if (moduleCode === "M3") {
    const rooms = safeArray(data.rooms);
    const completeRooms = rooms.filter(completeRoom).length;
    return pct([rooms.length > 0, completeRooms > 0, isFiniteNumberLike(data.bedsTotal), isFiniteNumberLike(data.unitsTotal)]);
  }

  if (moduleCode === "M4") {
    const employees = safeArray(data.employees);
    const activeEmployees = employees.filter((employee) => employee.employmentStatus !== "terminated");
    return pct([employees.length > 0, activeEmployees.length > 0, employees.some(completeEmployee), data.roleCoverageNotes]);
  }

  if (moduleCode === "M17") {
    const docs = safeArray(state?.documents);
    const docsWithMetadata = docs.filter(completeDocumentMetadata).length;
    const unresolved = getUnresolvedDuplicateGroups(state).length === 0;
    const invalid = getInvalidSourceOfTruthGroups(state).length === 0;
    return pct([docs.length > 0, docsWithMetadata === docs.length && docs.length > 0, unresolved, invalid]);
  }

  const intakeSpec = onboardingIntakeCatalog[moduleCode];
  if (intakeSpec) return getCatalogCompleteness(data, intakeSpec, state);

  return 0;
}
function getModuleReadinessMetrics(module, state) {
  const docs = safeArray(state?.documents);
  const contradictions = safeArray(state?.contradictions).filter((c) => c.affectedModuleNumber === module.moduleNumber || c.affectedModuleCode === module.moduleCode);
  const exceptions = safeArray(state?.exceptions).filter((e) => normalizeScopeId(e.scopeId) === normalizeScopeId(module.moduleCode) || e.scopeType === "module" && normalizeScopeId(e.scopeId) === normalizeScopeId(`M${module.moduleNumber}`));
  const evidenceCount = module.moduleCode === "M17" ? docs.length : Number(module.evidenceCount || 0);
  const staleCount = module.moduleCode === "M17" ? docs.filter((doc) => doc.currencyStatus === "stale").length : Number(module.staleCount || 0);
  const score = scoreModule(module, state);
  return {
    ...score,
    ownerName: module.ownerName || "Unassigned",
    scopeStatus: module.scopeStatus || "tbd",
    status: module.status || "not_started",
    evidenceCount,
    staleCount,
    contradictionCount: contradictions.filter((c) => c.status !== "resolved").length,
    exceptionCount: exceptions.length,
    nextAction: module.nextAction || (moduleHasOwnerCoverageOrException(module, state) ? "Review required fields" : "Assign accountable owner/source/due")
  };
}
function scoreModule(module, state) {
  const inScope = module.scopeStatus !== "out";
  if (!inScope) return { moduleCode: module.moduleCode, moduleName: module.moduleName, score: null, inScope: false, isMvpDetailed: module.isMvpDetailed };

  const approvedModuleException = hasApprovedModuleException(state, module);

  if (!MVP_CODES.has(module.moduleCode)) {
    const fields = [Boolean(module.ownerName), Boolean(module.source), Boolean(module.dueDate)].filter(Boolean).length;
    const statusBonus = module.status === "signed" || module.status === "ready_for_review" ? 10 : 0;
    const score = approvedModuleException || fields === 3 ? Math.min(100, 90 + statusBonus) : fields > 0 ? 50 : 0;
    return { moduleCode: module.moduleCode, moduleName: module.moduleName, score, inScope: true, isMvpDetailed: false, approvedModuleException };
  }

  const completeness = getMvpCompleteness(state, module.moduleCode);
  const ownerCoverage = moduleHasOwnerCoverageOrException(module, state) ? 1 : 0;
  const evidenceCoverage = module.moduleCode === "M17" ? (safeArray(state?.documents).length > 0 ? 1 : 0) : 1;
  const currencyScore = module.moduleCode === "M17" ? (getStaleDocumentsWithoutApprovedException(state).length === 0 ? 1 : 0) : 1;
  const reviewScore = module.status === "signed" || module.status === "ready_for_review" ? 1 : 0;

  let score = (completeness * 40) + (ownerCoverage * 20) + (evidenceCoverage * 20) + (currencyScore * 10) + (reviewScore * 10);

  if (!ownerCoverage) score -= 25;
  if (module.moduleCode === "M17" && getUnresolvedDuplicateGroups(state).length > 0) score -= 20;
  if (module.moduleCode === "M17" && getInvalidSourceOfTruthGroups(state).length > 0) score -= 20;
  if (module.moduleCode === "M17" && getStaleDocumentsWithoutApprovedException(state).length > 0) score -= 20;
  if (getOpenBlockingContradictions(state).some((c) => c.affectedModuleNumber === module.moduleNumber)) score -= 20;
  if (module.moduleCode === "M2" && !state?.mvpData?.M2?.operatingAddressConfirmed) score -= 20;
  if (module.moduleCode === "M1" && !(state?.mvpData?.M1?.operatingLlc && state?.mvpData?.M1?.propertyLlc)) score -= 20;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    moduleCode: module.moduleCode,
    moduleName: module.moduleName,
    score,
    inScope: true,
    isMvpDetailed: true,
    completenessPct: Math.round(completeness * 100),
    approvedModuleException
  };
}
function scoreFacility(state) {
  const moduleScores = safeArray(state?.modules).map((m) => scoreModule(m, state));
  const moduleMetrics = safeArray(state?.modules).map((m) => getModuleReadinessMetrics(m, state));
  const inScopeScores = moduleScores.filter((m) => m.inScope && typeof m.score === "number");
  const total = inScopeScores.reduce((sum, m) => sum + m.score, 0);
  const facilityReadinessScore = inScopeScores.length ? Math.round(total / inScopeScores.length) : 0;

  return {
    facilityReadinessScore,
    moduleScores,
    moduleMetrics,
    unresolvedDuplicateGroups: getUnresolvedDuplicateGroups(state),
    invalidSourceOfTruthGroups: getInvalidSourceOfTruthGroups(state),
    staleDocumentsWithoutApprovedException: getStaleDocumentsWithoutApprovedException(state),
    missingCoverageModules: getModulesMissingCoverage(safeArray(state?.modules), state)
  };
}

// ---- src/gates.js ----
function pass(label) {
  return { label, pass: true, severity: "info", blocker: "" };
}

function fail(label, blocker, severity = "blocking") {
  return { label, pass: false, severity, blocker };
}

function getStaleDocsNeedingAction(state) {
  return (state?.documents || []).filter((doc) => {
    if (doc.currencyStatus !== "stale") return false;
    const routed = Boolean(String(doc.routedOwnerName || "").trim());
    const approvedException = hasApprovedException(state, "document", doc.id);
    return !routed && !approvedException;
  });
}
function evaluateGate0(state) {
  const p = state?.program || {};
  const criteria = [];

  criteria.push(p.name ? pass("Program exists") : fail("Program exists", "Create program charter."));
  criteria.push(p.sponsor ? pass("Sponsor named") : fail("Sponsor named", "Assign executive sponsor."));
  criteria.push(p.deputySponsor ? pass("Deputy sponsor named") : fail("Deputy sponsor named", "Assign deputy sponsor."));
  criteria.push(p.cfo ? pass("CFO named") : fail("CFO named", "Assign CFO."));
  criteria.push(p.coo ? pass("COO named") : fail("COO named", "Assign COO."));
  criteria.push(p.onboarder ? pass("Onboarder named") : fail("Onboarder named", "Assign onboarder."));
  criteria.push(p.documentCustodian ? pass("Document custodian named") : fail("Document custodian named", "Assign document custodian."));
  criteria.push(state?.facility?.status === "pilot" ? pass("Homewood in pilot scope") : fail("Homewood in pilot scope", "Set Homewood status to pilot/in-scope."));
  criteria.push(p.homewoodScope ? pass("Homewood scope recorded") : fail("Homewood scope recorded", "Record Homewood pilot scope."));
  criteria.push(p.definitionOfLive ? pass("Definition of Live recorded") : fail("Definition of Live recorded", "Record Definition of Live."));
  criteria.push(p.thresholds?.moduleReadinessTarget ? pass("Thresholds defined") : fail("Thresholds defined", "Set readiness thresholds."));

  const blockers = criteria.filter((c) => !c.pass).map((c) => c.blocker);
  return {
    gate: "G0",
    pass: blockers.length === 0,
    criteria,
    blockers,
    requiredSignerRole: "Executive Sponsor"
  };
}
function evaluateGate2(state) {
  const scoring = scoreFacility(state);
  const missingCoverageModules = getModulesMissingCoverage(state?.modules || [], state);
  const unresolvedDuplicates = getUnresolvedDuplicateGroups(state);
  const invalidSotGroups = getInvalidSourceOfTruthGroups(state);
  const staleNeedingAction = getStaleDocsNeedingAction(state);
  const ownerlessOpenContradictions = (state?.contradictions || []).filter(
    (c) => c.status === "open" && !String(c.ownerName || "").trim()
  );

  const mvpCompletenessFailures = scoring.moduleScores.filter((m) => {
    if (!m.isMvpDetailed || typeof m.completenessPct !== "number" || m.completenessPct >= 95) return false;
    const module = (state?.modules || []).find((candidate) => candidate.moduleCode === m.moduleCode);
    return !hasApprovedModuleException(state, module);
  });

  const criteria = [];
  criteria.push(
    missingCoverageModules.length === 0
      ? pass("All modules have owner/source/due or approved exception")
      : fail(
          "All modules have owner/source/due or approved exception",
          `Missing owner/source/due coverage on modules: ${missingCoverageModules.map((m) => m.moduleCode).join(", ")}`
        )
  );

  criteria.push(
    mvpCompletenessFailures.length === 0
      ? pass("Complete onboarding modules >=95% data completeness or approved exception")
      : fail(
          "Complete onboarding modules >=95% data completeness or approved exception",
          `Onboarding data completeness below 95%: ${mvpCompletenessFailures.map((m) => `${m.moduleCode}(${m.completenessPct}%)`).join(", ")}`
        )
  );

  criteria.push(
    unresolvedDuplicates.length === 0
      ? pass("No unresolved duplicate source-of-truth groups")
      : fail(
          "No unresolved duplicate source-of-truth groups",
          `Unresolved duplicate groups: ${unresolvedDuplicates.map((g) => g.name).join(", ")}`
        )
  );

  criteria.push(
    invalidSotGroups.length === 0
      ? pass("No invalid source-of-truth selections")
      : fail(
          "No invalid source-of-truth selections",
          `Invalid source-of-truth groups: ${invalidSotGroups.map((g) => g.name).join(", ")}`
        )
  );

  criteria.push(
    staleNeedingAction.length === 0
      ? pass("Stale documents are owner-routed or exception-approved")
      : fail(
          "Stale documents are owner-routed or exception-approved",
          `Stale docs need route/approval: ${staleNeedingAction.map((d) => d.title).join(", ")}`,
          "major"
        )
  );

  criteria.push(
    ownerlessOpenContradictions.length === 0
      ? pass("Open contradictions have named owners")
      : fail(
          "Open contradictions have named owners",
          `Ownerless contradictions: ${ownerlessOpenContradictions.map((c) => c.id).join(", ")}`
        )
  );

  const scoreTarget = Number(state?.program?.thresholds?.gate2FacilityScoreTarget || 90);
  criteria.push(
    scoring.facilityReadinessScore >= scoreTarget
      ? pass("Facility readiness meets Gate 2 threshold")
      : fail(
          "Facility readiness meets Gate 2 threshold",
          `Facility readiness ${scoring.facilityReadinessScore} is below Gate 2 target ${scoreTarget}`
        )
  );

  const blockers = criteria.filter((c) => !c.pass).map((c) => c.blocker);

  return {
    gate: "G2",
    pass: blockers.length === 0,
    criteria,
    blockers,
    facilityReadinessScore: scoring.facilityReadinessScore,
    requiredSignerRole: "Executive Sponsor / COO"
  };
}

// ---- src/export.js ----
function line(text = "") {
  return `${text}\n`;
}

function recentDecisionLog(state, count = 6) {
  return (state.decisionLog || []).slice(0, count);
}

function sourceOfTruthDecisions(state) {
  return (state.documentGroups || []).map((group) => {
    const selected = (state.documents || []).find((doc) => doc.id === group.sourceOfTruthDocumentId);
    return { group, selected };
  });
}

function signedGates(state) {
  return (state.gates || []).filter((gate) => gate.status === "signed" || gate.signedAt);
}

function operationalIntakeSnapshot(state) {
  return Object.entries(onboardingIntakeCatalog).map(([code, spec]) => {
    const module = (state.modules || []).find((m) => m.moduleCode === code) || {};
    const metric = scoreFacility(state).moduleMetrics.find((m) => m.moduleCode === code) || {};
    const data = state.mvpData?.[code] || {};
    return {
      code,
      name: module.moduleName || code,
      completenessPct: metric.completenessPct ?? 0,
      purpose: spec.purpose,
      requiredChecklist: spec.checklist || [],
      scalarFields: (spec.fields || []).map((field) => ({ key: field.key, label: field.label, present: Boolean(String(data[field.key] ?? "").trim()) })),
      collections: (spec.collections || []).map((collection) => ({
        key: collection.key,
        label: collection.label,
        recordCount: Array.isArray(data[collection.key]) ? data[collection.key].length : 0,
        requiredFields: collection.requiredFields || []
      }))
    };
  });
}
function buildLaunchNarrative(state) {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const staleCount = (state.documents || []).filter((doc) => doc.currencyStatus === "stale").length;
  const unresolvedDuplicates = score.unresolvedDuplicateGroups.length;
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open");
  const signed = signedGates(state).map((gate) => gate.code).join(", ") || "none yet";

  return [
    `Homewood is being converted from scattered onboarding evidence into a verified Facility DNA operating model.`,
    `Readiness is ${score.facilityReadinessScore}/100 with Gate 0 ${g0.pass ? "ready" : "blocked"} and Gate 2 ${g2.pass ? "ready" : "blocked"}; signed gates: ${signed}.`,
    `The visible complexity is dual legal entities (${state.mvpData?.M1?.operatingLlc || "operating LLC TBD"} vs ${state.mvpData?.M1?.propertyLlc || "property LLC TBD"}), ${staleCount} stale document(s), ${unresolvedDuplicates} unresolved duplicate group(s), and ${openContradictions.length} open contradiction(s).`,
    `Next action: ${g2.blockers[0] || "export signed readiness packet and move to launch preparation."}`
  ].join(" ");
}
function buildReadinessMarkdown(state) {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const approvedExceptions = (state.exceptions || []).filter((e) => e.status === "approved");
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open");

  let out = "";
  out += line("# Facility Launch Readiness Summary");
  out += line(`- Program: ${state.program?.name || ""}`);
  out += line(`- Facility: ${state.facility?.name || ""}`);
  out += line(`- Facility Score: ${score.facilityReadinessScore}`);
  out += line(`- Gate 0: ${g0.pass ? "PASS" : "BLOCKED"}`);
  out += line(`- Gate 2: ${g2.pass ? "PASS" : "BLOCKED"}`);
  out += line();

  out += line("## Launch Narrative / Executive Summary");
  out += line(buildLaunchNarrative(state));
  out += line();

  out += line("## Signed Gate Records");
  const gates = signedGates(state);
  if (!gates.length) out += line("- None signed yet");
  gates.forEach((gate) => {
    out += line(`- ${gate.code} ${gate.name}: signed by ${gate.signedBy || ""} (${gate.signedRole || gate.requiredSignerRole || "role not recorded"}) at ${gate.signedAt || ""}`);
    out += line(`  - Criteria snapshot: ${(gate.criteriaSnapshot?.criteria || []).filter((c) => c.pass).length}/${(gate.criteriaSnapshot?.criteria || []).length} pass; blockers=${(gate.criteriaSnapshot?.blockers || []).length}`);
    out += line(`  - Exceptions relied upon: ${(gate.criteriaSnapshot?.exceptionsReliedUpon || []).map((e) => e.id).join(", ") || "none"}`);
  });
  out += line();

  out += line("## Current Criteria Snapshot Summary");
  [g0, g2].forEach((gate) => {
    out += line(`- ${gate.gate}: ${gate.criteria.filter((c) => c.pass).length}/${gate.criteria.length} pass; required signer=${gate.requiredSignerRole}`);
    gate.criteria.filter((c) => !c.pass).forEach((criterion) => out += line(`  - BLOCKED: ${criterion.blocker}`));
  });
  out += line();

  out += line("## Readiness Map Snapshot");
  score.moduleMetrics.forEach((m) => {
    out += line(`- ${m.moduleCode} ${m.moduleName}: score=${m.score ?? "N/A"}, completeness=${m.completenessPct ?? "N/A"}%, owner=${m.ownerName}, scope=${m.scopeStatus}, status=${m.status}, evidence=${m.evidenceCount}, stale=${m.staleCount}, contradictions=${m.contradictionCount}, exceptions=${m.exceptionCount}, next=${m.nextAction}`);
  });
  out += line();
  out += line("## Complete Onboarding Intake Coverage");
  operationalIntakeSnapshot(state).forEach((module) => {
    out += line(`- ${module.code} ${module.name}: completeness=${module.completenessPct}%`);
    module.collections.forEach((collection) => {
      out += line(`  - ${collection.label}: ${collection.recordCount} record(s); required=${collection.requiredFields.join(", ")}`);
    });
  });
  out += line();

  out += line("## Owner Worksheet Coverage");
  (state.modules || []).forEach((m) => {
    out += line(`- ${m.moduleCode} ${m.moduleName}: owner=${m.ownerName || "missing"}, source=${m.source || "missing"}, due=${m.dueDate || "missing"}, scope=${m.scopeStatus}, status=${m.status}, next=${m.nextAction || ""}`);
  });
  out += line();

  out += line("## Source-of-Truth Decisions");
  sourceOfTruthDecisions(state).forEach(({ group, selected }) => {
    out += line(`- ${group.name}: ${selected ? `${selected.title} (${selected.artifactType}, ${selected.currencyStatus}, approval=${selected.custodianApprovalStatus})` : "unresolved"}`);
  });
  out += line();

  out += line("## Exceptions Relied Upon");
  if (!approvedExceptions.length) out += line("- None");
  approvedExceptions.forEach((e) => {
    out += line(`- ${e.id}: ${e.scopeType}:${e.scopeId} — ${e.description} | approver=${e.approverName || ""} (${e.approverRole || ""}) at ${e.approvedAt || ""}`);
  });
  out += line();

  out += line("## Contradiction Summary");
  if (!openContradictions.length) out += line("- No open contradictions");
  openContradictions.forEach((c) => {
    out += line(`- ${c.id}: ${c.summary} | owner=${c.ownerName || "unassigned"} | decisionOwner=${c.decisionOwner || ""}`);
    if (c.type === "policy_reality_app") out += line(`  - Policy=${c.policyValue || ""}; Reality=${c.realityValue || ""}; App Setting=${c.appSettingValue || ""}`);
    if (c.resolutionNotes) out += line(`  - Resolution notes=${c.resolutionNotes}`);
  });
  out += line();

  out += line("## Recent Decision Log Excerpts");
  recentDecisionLog(state).forEach((entry) => {
    out += line(`- ${entry.timestamp} — ${entry.actionType}: ${entry.summary}`);
  });

  return out;
}
function buildStateJsonExport(state) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      launchNarrative: buildLaunchNarrative(state),
      program: state.program,
      facility: state.facility,
      gates: state.gates,
      signedGates: signedGates(state),
      sourceOfTruthDecisions: sourceOfTruthDecisions(state),
      readiness: {
        score: scoreFacility(state),
        gate0: evaluateGate0(state),
        gate2: evaluateGate2(state)
      },
      modules: state.modules,
      mvpData: state.mvpData,
      completeOnboardingIntake: operationalIntakeSnapshot(state),
      documents: state.documents,
      documentGroups: state.documentGroups,
      exceptions: state.exceptions,
      contradictions: state.contradictions,
      decisionLog: state.decisionLog
    },
    null,
    2
  );
}

// ---- src/supabasePipeline.js ----
const CONFIG_KEY = "facilityLaunchCenter.supabasePipeline.v1";

function trimSlash(value = "") {
  return String(value || "").replace(/\/+$/, "");
}
function loadPipelineConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function savePipelineConfig(config) {
  const cleaned = {
    supabaseUrl: trimSlash(config.supabaseUrl),
    anonKey: String(config.anonKey || "").trim(),
    accessToken: String(config.accessToken || "").trim(),
    organizationId: String(config.organizationId || "").trim(),
    facilityId: String(config.facilityId || "").trim()
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cleaned));
  return cleaned;
}
function pipelineConfigured(config = loadPipelineConfig()) {
  return Boolean(config.supabaseUrl && config.anonKey && config.accessToken && config.organizationId);
}
function promotionConfigured(config = loadPipelineConfig()) {
  return pipelineConfigured(config) && Boolean(config.facilityId);
}

async function edgeFetch(config, functionName, init) {
  if (!pipelineConfigured(config)) {
    throw new Error("Supabase pipeline is not configured. Add URL, anon key, current user JWT, and organization id.");
  }
  const response = await fetch(`${trimSlash(config.supabaseUrl)}/functions/v1/${functionName}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${functionName} failed (${response.status})`);
  return payload;
}
async function uploadDocumentToSupabasePipeline(file, metadata, config = loadPipelineConfig()) {
  if (!file) throw new Error("Choose a file before starting Supabase OCR/AI intake.");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", metadata.title || file.name);
  formData.append("workspace_id", config.organizationId);
  formData.append("audience", "facility_scoped");
  formData.append("status", "pending_review");

  const ingest = await edgeFetch(config, "ingest", {
    method: "POST",
    body: formData
  });

  const parsed = await edgeFetch(config, "facility-launch-parser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "parse_document",
      document_id: ingest.document_id,
      facility_id: config.facilityId || null
    })
  });

  return { ingest, parsed };
}
async function parserAction(action, body, config = loadPipelineConfig()) {
  return edgeFetch(config, "facility-launch-parser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
}

/**
 * Push the current Facility Launch Center state into Haven's
 * facility_launch_module_values table via the facility-launch-import Edge Function.
 *
 *   state      - the FLC export JSON (anything with `mvpData`, normally what
 *                buildStateJsonExport returns)
 *   options    - { dryRun?: boolean }
 *   config     - pipeline config (defaults to loadPipelineConfig())
 *
 * Returns the edge function response: { inserts, updates, noops, gap_report, rows, ... }
 */
async function pushStateToHaven(state, options = {}, config = loadPipelineConfig()) {
  if (!state || typeof state !== "object") throw new Error("Cannot push: state is missing.");
  return edgeFetch(config, "facility-launch-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      organization_id: config.organizationId,
      facility_id: config.facilityId || null,
      dry_run: Boolean(options.dryRun)
    })
  });
}

/**
 * One-click Facility Launch handoff:
 *   1. Capture the current FLC export into facility_launch_module_values.
 *   2. Promote every ready intake module into the app-visible operational tables.
 *
 * Dry-run preserves the Item 1 invariant: no writes. It previews capture only,
 * because promotion reads persisted intake and would otherwise show stale data
 * instead of the current draft.
 */
async function pushAndPromoteStateToHaven(state, options = {}, config = loadPipelineConfig()) {
  if (!promotionConfigured(config)) {
    throw new Error("Supabase URL, anon key, current user JWT, organization id, and facility id are required before promoting to Haven.");
  }
  const dryRun = Boolean(options.dryRun);
  const captured = await pushStateToHaven(state, { dryRun }, config);
  if (dryRun) {
    return {
      mode: "dry_run",
      dry_run: true,
      captured,
      promoted: {
        run_id: null,
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        mode: "dry_run",
        modules_promoted: [],
        summary: "Promotion preview skipped because capture dry-run does not write current intake. Run an apply when ready to promote the just-captured state.",
        gap_modules: []
      },
      note: "Dry-run previews capture only. Promotion is intentionally skipped to avoid showing stale persisted intake as if it were the current draft."
    };
  }

  let promoted;
  try {
    promoted = await edgeFetch(config, "facility-launch-promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        dry_run: false
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Promotion failed.";
    return {
      mode: "partial",
      dry_run: false,
      captured,
      promoted: {
        run_id: null,
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        mode: "apply",
        modules_promoted: [],
        summary: "Capture succeeded, but promotion failed.",
        gap_modules: [],
        error: message
      },
      note: `Capture succeeded, but promotion failed: ${message}`
    };
  }

  return {
    mode: "apply",
    dry_run: false,
    captured,
    promoted,
    note: "Captured current Facility Launch state and promoted ready modules into live Haven tables."
  };
}

// ---- src/app.js ----
let state = loadState();
let activeTab = "overview";
let lastDocumentSaveSummary = "";
let pipelineMessage = "";
let pushResult = null;       // last response from pushAndPromoteStateToHaven (success)
let pushError = "";          // last error message from pushAndPromoteStateToHaven (failure)
let pushBusy = false;        // true while a push is in flight
let pushDryRun = true;       // toggled by the "Preview only" checkbox

const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");
const viewEl = document.getElementById("view");
const decisionLogEl = document.getElementById("decision-log");
const resetButton = document.getElementById("reset-demo");
const loadRound1Button = document.getElementById("load-round1-state");
const ROUND1_STATE_URL = new URL("../data/homewood-round1-state.json", import.meta.url);

const MODULE_STATUSES = ["not_started", "assigned", "in_progress", "ready_for_review", "signed", "blocked"];
const SCOPE_STATUSES = ["in", "out", "tbd"];
const ARTIFACT_TYPES = ["state_license", "gl_cert", "property_insurance", "property_policy", "bond_certificate", "loss_run", "floor_plan", "emergency_plan", "vendor_agreement", "compilation_file", "other"];
const CURRENCY_STATUSES = ["fresh", "aging", "stale", "unknown"];
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "needs_review"];
const CONFIDENCE_LEVELS = ["low", "medium", "high", "manual"];

const tabs = [
  ["overview", "Facility Command Center"],
  ["program", "Program Charter"],
  ["worksheet", "Module Owners & Due Dates"],
  ["readiness", "Readiness Map"],
  ["modules", "Onboarding Intake"],
  ["docs", "Document Intake"],
  ["exceptions", "Exceptions"],
  ["contradictions", "Policy vs Reality Checks"],
  ["gates", "Gate Checks"],
  ["export", "Export"]
];

function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[m]));
}

function option(value, selected) {
  return `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`;
}

function currencyBadge(status) {
  return `<span class="badge badge-${esc(status || "na")}">${esc(status || "n/a")}</span>`;
}

function statusBadge(status) {
  const normalized = String(status || "unknown").replaceAll("_", "-");
  return `<span class="badge badge-${esc(normalized)}">${esc(status || "unknown")}</span>`;
}

function field(label, html, hint = "") {
  return `<label class="field"><span>${esc(label)}</span>${html}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}

function input(attrs) {
  const { label, value = "", hint = "", ...rest } = attrs;
  const attr = Object.entries(rest).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return field(label, `<input ${attr} value="${esc(value)}" />`, hint);
}

function textarea(attrs) {
  const { label, value = "", hint = "", ...rest } = attrs;
  const attr = Object.entries(rest).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return field(label, `<textarea ${attr}>${esc(value)}</textarea>`, hint);
}

function getGateStatusLabel(g) {
  const signed = (state.gates || []).find((x) => x.code === g.gate)?.signedAt;
  if (signed) return "SIGNED";
  return g.pass ? "READY" : "BLOCKED";
}

function renderTabs() {
  tabsEl.innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="tab ${activeTab === id ? "active" : ""}">${label}</button>`).join("");
}

function renderSummary() {
  const score = scoreFacility(state);
  const g0 = evaluateGate0(state);
  const g2 = evaluateGate2(state);
  const staleCount = (state.documents || []).filter((d) => d.currencyStatus === "stale").length;
  const openContradictions = (state.contradictions || []).filter((c) => c.status === "open").length;
  summaryEl.innerHTML = `
    <div class="command-hero">
      <div>
        <p class="eyebrow">Facility DNA Launch Command</p>
        <h2>${esc(state.facility.name)}</h2>
        <p>${esc(buildLaunchNarrative(state))}</p>
      </div>
      <div class="hero-score"><span>${score.facilityReadinessScore}</span><small>readiness</small></div>
    </div>
    <div class="cards kpis">
      <div class="card"><h4>Gate 0</h4><p>${getGateStatusLabel(g0)}</p><small>${g0.criteria.filter((c) => c.pass).length}/${g0.criteria.length} criteria pass</small></div>
      <div class="card"><h4>Gate 2</h4><p>${getGateStatusLabel(g2)}</p><small>${g2.blockers.length} blocker(s)</small></div>
      <div class="card"><h4>Documents</h4><p>${state.documents.length}</p><small>${staleCount} stale · ${score.unresolvedDuplicateGroups.length} duplicate group(s) unresolved</small></div>
      <div class="card"><h4>Contradictions</h4><p>${openContradictions}</p><small>Policy vs Reality vs App visible</small></div>
      <div class="card"><h4>Import Reviews</h4><p>${(state.ingestionReviewQueue || []).length}</p><small>Round 1 records needing review</small></div>
      <div class="card"><h4>Import Gaps</h4><p>${(state.ingestionGaps || []).length}</p><small>Second-pass source queue</small></div>
    </div>
  `;
}

function renderIngestionQueues() {
  const gaps = state.ingestionGaps || [];
  const reviews = state.ingestionReviewQueue || [];
  const manifest = state.ingestionManifest || null;
  if (!manifest && !gaps.length && !reviews.length) return "";
  const gapRows = gaps.length
    ? gaps.map((gap) => `<tr><td>${esc(gap.moduleCode)}</td><td>${esc(gap.sourceId)}</td><td>${esc(gap.fieldOrRecord)}</td><td>${esc(gap.reason)}</td></tr>`).join("")
    : `<tr><td colspan="4">No Round 1/2 gap records loaded.</td></tr>`;
  const reviewRows = reviews.length
    ? reviews.slice(0, 12).map((item) => `<tr><td>${esc((item.moduleCodes || []).join(", "))}</td><td>${esc(item.sourceId)}</td><td>${esc(item.targetEntity)}</td><td>${esc(item.reason)}</td></tr>`).join("")
    : `<tr><td colspan="4">No review queue records loaded.</td></tr>`;
  return `
    <div class="panel-ish span2">
      <div class="row-between">
        <div>
          <p class="eyebrow">Round 1 Real Import</p>
          <h3>${manifest ? "Homewood Round 1 state loaded" : "No generated import loaded"}</h3>
        </div>
        <div class="mini-kpis">
          <span class="badge badge-info">${esc(manifest?.artifactCount || 0)}/${esc(manifest?.sourceCount || 0)} sources</span>
          <span class="badge badge-watch">${reviews.length} review</span>
          <span class="badge badge-blocked">${gaps.length} gaps</span>
        </div>
      </div>
      <p>${esc(manifest?.roundPolicy || "Click Load Round 1 Import to hydrate the app from normalized artifacts.")}</p>
      <div class="grid2">
        <div>
          <h4>Second-pass gap queue</h4>
          <div class="table-wrap compact-table"><table><thead><tr><th>Module</th><th>Source</th><th>Field/source</th><th>Reason</th></tr></thead><tbody>${gapRows}</tbody></table></div>
        </div>
        <div>
          <h4>Needs-review queue</h4>
          <div class="table-wrap compact-table"><table><thead><tr><th>Module</th><th>Source</th><th>Target</th><th>Reason</th></tr></thead><tbody>${reviewRows}</tbody></table></div>
          ${reviews.length > 12 ? `<small>Showing first 12 of ${reviews.length} review records.</small>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderOverview() {
  const score = scoreFacility(state);
  const g2 = evaluateGate2(state);
  const sotResolved = (state.documentGroups || []).filter((g) => g.sourceOfTruthDocumentId).length;
  return `
    <section class="command-grid">
      <div class="panel-ish span2">
        <p class="eyebrow">North Star</p>
        <h2>Learn the facility. Verify the operating model. Launch with accountable owners.</h2>
        <p class="lead">This Facility Launch Center turns Homewood's scattered legal/entity, staffing, room, document, and policy evidence into a Facility DNA record that executives can sign.</p>
      </div>
      <div class="panel-ish">
        <h3>What is ready</h3>
        <ul class="clean-list">
          <li>Program container and Gate 0 authority are modeled.</li>
          <li>${sotResolved}/${state.documentGroups.length} document groups have source-of-truth decisions.</li>
          <li>${score.moduleMetrics.filter((m) => m.score >= 95).length}/19 module cards are launch-ready or exception-backed.</li>
        </ul>
      </div>
      <div class="panel-ish danger-soft">
        <h3>What is blocked</h3>
        <ul>${(g2.blockers.length ? g2.blockers : ["No Gate 2 blockers"]).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>
      ${renderIngestionQueues()}
      <div class="panel-ish">
        <h3>Homewood complexity surfaced</h3>
        <div class="complexity-list">
          <div><strong>Dual entities</strong><span>${esc(state.mvpData.M1.operatingLlc || "Operating LLC TBD")} / ${esc(state.mvpData.M1.propertyLlc || "Property LLC TBD")}</span></div>
          <div><strong>Stale docs</strong><span>${(state.documents || []).filter((d) => d.currencyStatus === "stale").length} evidence rows need routing or exception.</span></div>
          <div><strong>Duplicate docs</strong><span>${score.unresolvedDuplicateGroups.map((g) => g.name).join(", ") || "Resolved"}</span></div>
          <div><strong>Rounds reality</strong><span>Policy vs interview reality vs app setting contradiction is tracked and owned.</span></div>
          <div><strong>Claims awareness</strong><span>Loss run evidence routes to CFO/Legal awareness before launch.</span></div>
        </div>
      </div>
      <div class="panel-ish">
        <h3>What changed recently</h3>
        <ul>${(state.decisionLog || []).slice(0, 6).map((d) => `<li><strong>${esc(d.actionType)}</strong><br><span>${esc(d.summary)}</span></li>`).join("")}</ul>
      </div>
    </section>
  `;
}

function renderProgram() {
  const p = state.program || {};
  const t = p.thresholds || {};
  const g0 = evaluateGate0(state);
  return `
    <h2>Program Setup / Charter</h2>
    <p class="lead">Gate 0 updates live from this charter. Capture who can authorize launch work, what Homewood includes, and what “Live” means.</p>
    <div class="grid2">
      ${input({ label: "Program name", "data-program": "name", value: p.name })}
      ${input({ label: "Executive sponsor", "data-program": "sponsor", value: p.sponsor })}
      ${input({ label: "Deputy sponsor", "data-program": "deputySponsor", value: p.deputySponsor })}
      ${input({ label: "CFO", "data-program": "cfo", value: p.cfo })}
      ${input({ label: "COO", "data-program": "coo", value: p.coo })}
      ${input({ label: "Onboarder", "data-program": "onboarder", value: p.onboarder })}
      ${input({ label: "Document custodian", "data-program": "documentCustodian", value: p.documentCustodian })}
      ${input({ label: "MVP readiness target", type: "number", "data-threshold": "moduleReadinessTarget", value: t.moduleReadinessTarget })}
      ${input({ label: "Stale document months", type: "number", "data-threshold": "staleMonths", value: t.staleMonths })}
      ${input({ label: "Gate 2 facility score target", type: "number", "data-threshold": "gate2FacilityScoreTarget", value: t.gate2FacilityScoreTarget })}
      ${textarea({ label: "Definition of Live", "data-program": "definitionOfLive", value: p.definitionOfLive })}
      ${textarea({ label: "Homewood scope", "data-program": "homewoodScope", value: p.homewoodScope })}
    </div>
    <h3>Gate 0 checklist</h3>
    <ul class="criteria-list">${g0.criteria.map((c) => `<li class="${c.pass ? "ok" : "fail"}"><strong>${c.pass ? "PASS" : "BLOCK"}</strong> ${esc(c.label)}${c.blocker ? `<small>${esc(c.blocker)}</small>` : ""}</li>`).join("")}</ul>
  `;
}

function renderWorksheet() {
  const rows = (state.modules || []).map((m) => `
    <tr>
      <td><strong>${esc(m.moduleCode)}</strong><br><span>${esc(m.moduleName)}</span></td>
      <td><input data-ws="ownerName" data-code="${m.moduleCode}" value="${esc(m.ownerName)}" placeholder="One accountable owner" /></td>
      <td><input data-ws="ownerTitle" data-code="${m.moduleCode}" value="${esc(m.ownerTitle)}" placeholder="Title" /></td>
      <td><input data-ws="source" data-code="${m.moduleCode}" value="${esc(m.source)}" placeholder="System, binder, person" /></td>
      <td><input type="date" data-ws="dueDate" data-code="${m.moduleCode}" value="${esc(m.dueDate)}" /></td>
      <td><select data-ws="scopeStatus" data-code="${m.moduleCode}">${SCOPE_STATUSES.map((s) => option(s, m.scopeStatus)).join("")}</select></td>
      <td><select data-ws="status" data-code="${m.moduleCode}">${MODULE_STATUSES.map((s) => option(s, m.status)).join("")}</select></td>
      <td><input data-ws="nextAction" data-code="${m.moduleCode}" value="${esc(m.nextAction || "")}" placeholder="Next action" /></td>
      <td><textarea data-ws="openQuestions" data-code="${m.moduleCode}" placeholder="Open questions">${esc(m.openQuestions)}</textarea></td>
    </tr>
  `).join("");
  return `<h2>Launch Accountability Matrix (19 modules)</h2><p class="lead"><strong>This is not the resident/rate intake screen.</strong> This table assigns the accountable human, source of truth, due date, and next action for each onboarding module. Actual resident, rate, rounds, care, staffing, vendor, and KPI data is entered in <strong>Complete Intake / Facility DNA</strong>.</p><div class="table-wrap"><table><thead><tr><th>Module</th><th>Data Owner</th><th>Owner Title</th><th>Source of Truth</th><th>Due</th><th>Scope</th><th>Status</th><th>Next Action</th><th>Open Questions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderReadiness() {
  const score = scoreFacility(state);
  const g2 = evaluateGate2(state);
  return `
    <h2>Facility Readiness Map</h2>
    <p class="lead">Hero map of Facility DNA readiness: what is known, what is stale, who owns the next move, and what blocks launch.</p>
    <div class="readiness-grid">${score.moduleMetrics.map((m) => `<button class="readiness-card ${m.score >= 95 ? "ready" : m.score >= 70 ? "watch" : "blocked"}" data-tab="modules">
      <div class="row-between"><h4>${esc(m.moduleCode)} ${esc(m.moduleName)}</h4>${statusBadge(m.status)}</div>
      <div class="score-line"><span>${m.score ?? "N/A"}</span><small>${m.completenessPct ?? "N/A"}% complete</small></div>
      <dl>
        <div><dt>Owner</dt><dd>${esc(m.ownerName)}</dd></div>
        <div><dt>Scope</dt><dd>${esc(m.scopeStatus)}</dd></div>
        <div><dt>Evidence</dt><dd>${m.evidenceCount}</dd></div>
        <div><dt>Stale</dt><dd>${m.staleCount}</dd></div>
        <div><dt>Contradictions</dt><dd>${m.contradictionCount}</dd></div>
        <div><dt>Exceptions</dt><dd>${m.exceptionCount}</dd></div>
      </dl>
      <p><strong>Next:</strong> ${esc(m.nextAction)}</p>
    </button>`).join("")}</div>
    <h3>Gate 2 blockers</h3>
    <ul>${(g2.blockers.length ? g2.blockers : ["No blockers — Gate 2 can be signed."]).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
  `;
}

function fieldHelp(fieldDef) {
  return fieldDef.help || fieldDef.hint || (fieldDef.sampleValue ? `Example: ${fieldDef.sampleValue}` : "");
}

function fieldPlaceholder(fieldDef) {
  return fieldDef.placeholder || fieldDef.sampleValue || fieldDef.label || "";
}

function normalizeOption(optionItem) {
  if (typeof optionItem === "object" && optionItem !== null) {
    return { value: String(optionItem.value ?? optionItem.label ?? ""), label: String(optionItem.label ?? optionItem.value ?? "") };
  }
  return { value: String(optionItem ?? ""), label: String(optionItem ?? "") };
}

function renderOptions(options = [], selected = "") {
  const normalizedOptions = options.map(normalizeOption);
  const hasSelected = !selected || normalizedOptions.some((optionItem) => optionItem.value === selected);
  const selectedOption = hasSelected ? "" : `<option value="${esc(selected)}" selected>${esc(selected)} (existing)</option>`;
  return `${selectedOption}${normalizedOptions.map((optionItem) => `<option value="${esc(optionItem.value)}" ${optionItem.value === selected ? "selected" : ""}>${esc(optionItem.label)}</option>`).join("")}`;
}

function renderIntakeFieldControl(fieldDef, attrs = {}, value = "") {
  const normalizedAttrs = Object.fromEntries(Object.entries(attrs).filter(([, attrValue]) => attrValue !== "" && attrValue !== false && attrValue !== null && attrValue !== undefined));
  const attr = Object.entries(normalizedAttrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  const type = fieldDef.control || fieldDef.type || "text";
  if (fieldDef.relation) {
    const options = relationOptions(fieldDef);
    const disabled = options.length ? "" : "disabled";
    return `<select ${attr} ${disabled} data-relation="${esc(fieldDef.relation)}">
      <option value="">${options.length ? `Select ${fieldDef.label}` : `Add ${fieldDef.label.toLowerCase()} records first`}</option>
      ${options.map((optionItem) => `<option value="${esc(optionItem.value)}" ${optionItem.value === value ? "selected" : ""}>${esc(optionItem.label)}</option>`).join("")}
    </select>`;
  }
  if (type === "select" || fieldDef.options?.length) {
    return `<select ${attr}>
      <option value="">${esc(fieldDef.selectPrompt || `Choose ${fieldDef.label}`)}</option>
      ${renderOptions(fieldDef.options || [], value)}
    </select>`;
  }
  if (type === "yesNo") {
    return `<select ${attr}>
      <option value="">Choose yes/no</option>
      ${renderOptions(fieldDef.options || ["Yes", "No", "Unknown / not decided", "Not applicable"], value)}
    </select>`;
  }
  if (type === "textarea") return `<textarea ${attr}>${esc(value)}</textarea>`;
  return `<input ${attr} type="${esc(type)}" value="${esc(value)}" />`;
}

function renderCatalogField(fieldDef, attrs = {}, value = "") {
  const control = renderIntakeFieldControl(fieldDef, {
    placeholder: fieldPlaceholder(fieldDef),
    ...attrs
  }, value);
  return field(fieldDef.label, control, fieldHelp(fieldDef));
}

function renderScalarIntakeFields(code, spec, data) {
  if (!spec.fields?.length) return "";
  return `<div class="grid2">${spec.fields.map((f) => renderCatalogField(f, {
    "data-mvp": code,
    "data-field": f.key
  }, data?.[f.key] || "")).join("")}</div>`;
}

function renderIntakeChecklist(spec) {
  return `<div class="checklist-block"><p class="checklist-label">Topics this module must cover — enter details in the fields and table below</p><ul class="checklist-grid">${(spec.checklist || []).map((item) => `<li><span aria-hidden="true">✓</span>${esc(item)}</li>`).join("")}</ul></div>`;
}

function getResidentOptions() {
  return (state.mvpData?.M5?.residents || []).map((resident) => ({
    value: resident.id,
    label: `${resident.fullLegalName || resident.preferredName || resident.id}${resident.roomBed ? ` — ${resident.roomBed}` : ""}`,
    name: resident.fullLegalName || resident.preferredName || resident.id
  })).filter((optionItem) => optionItem.value);
}

function relationOptions(fieldDef) {
  if (fieldDef.relation === "resident") return getResidentOptions();
  return [];
}

function renderCollectionFieldControl(fieldDef, attrs = {}, value = "", options = {}) {
  const control = renderIntakeFieldControl(fieldDef, attrs, value);
  if (options.withLabel) return field(fieldDef.label, control, fieldHelp(fieldDef));
  return control;
}

function enrichLinkedPayload(payload) {
  const next = { ...payload };
  if (next.residentId) {
    const resident = (state.mvpData?.M5?.residents || []).find((candidate) => candidate.id === next.residentId);
    if (resident) next.residentName = resident.fullLegalName || resident.preferredName || resident.id;
  }
  return next;
}

function enrichCollectionField(fieldDef, collection) {
  const sampleValue = collection.sampleRecord?.[fieldDef.key];
  return {
    ...fieldDef,
    placeholder: fieldDef.placeholder || sampleValue || fieldDef.label,
    sampleValue: fieldDef.sampleValue || sampleValue || ""
  };
}

function renderRecordForm(code, collection) {
  const relationBlocked = (collection.fields || []).some((fieldDef) => fieldDef.relation === "resident") && !getResidentOptions().length;
  return `<form class="inline-form wrap module-record-form" data-module-record-form data-module-code="${esc(code)}" data-collection-key="${esc(collection.key)}">
    ${(collection.fields || []).map((fieldDef) => {
      const enrichedFieldDef = enrichCollectionField(fieldDef, collection);
      return renderCollectionFieldControl(enrichedFieldDef, {
        name: enrichedFieldDef.key,
        placeholder: fieldPlaceholder(enrichedFieldDef),
        required: collection.requiredFields?.includes(enrichedFieldDef.key) ? "required" : ""
      }, "", { withLabel: true });
    }).join("")}
    <button type="submit" ${relationBlocked ? "disabled" : ""}>${relationBlocked ? "Add resident in M5 first" : esc(collection.addLabel || `Add ${collection.label}`)}</button>
  </form>`;
}

function renderEditableRecordCells(code, collectionKey, row, fields) {
  return fields.map((fieldDef) => `<td>${renderCollectionFieldControl(fieldDef, {
    "data-record-field": fieldDef.key,
    "data-record-module": code,
    "data-record-collection": collectionKey,
    "data-record-id": row.id || ""
  }, row[fieldDef.key] || "")}</td>`).join("");
}

function renderRecordTable(code, collection, rows) {
  const fields = collection.fields || [];
  const body = rows.length
    ? rows.map((row) => `<tr>${renderEditableRecordCells(code, collection.key, row, fields)}<td><button type="button" class="danger-button" data-record-delete data-record-module="${esc(code)}" data-record-collection="${esc(collection.key)}" data-record-id="${esc(row.id || "")}">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="${Math.max(fields.length + 1, 1)}">${collection.emptyState ? esc(collection.emptyState) : (code === "M19" ? "No launch scoreboard numbers yet. The COO cannot run the daily go-live huddle until the critical numbers, owners, sources, and red-condition actions are entered here." : `No ${esc(collection.label.toLowerCase())} added yet. Add the first record below to start building this module.`)}</td></tr>`;
  return `<div class="table-wrap compact-table"><table><thead><tr>${fields.map((fieldDef) => `<th>${esc(fieldDef.columnLabel || fieldDef.label)}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderIntakeCoverageSummary() {
  const metrics = scoreFacility(state).moduleMetrics.filter((m) => onboardingIntakeCatalog[m.moduleCode]);
  return `<div class="cards intake-scorecards">${metrics.map((m) => `<div class="card ${m.completenessPct >= 95 ? "ready-soft" : "danger-soft"}"><h4>${esc(m.moduleCode)} ${esc(m.moduleName)}</h4><p>${esc(m.completenessPct ?? 0)}%</p><small>${esc(m.nextAction || "Complete intake")}</small></div>`).join("")}</div>`;
}

function renderOperationalIntakeModules() {
  const metricsByCode = new Map(scoreFacility(state).moduleMetrics.map((metric) => [metric.moduleCode, metric]));
  return Object.entries(onboardingIntakeCatalog).map(([code, spec]) => {
    const module = (state.modules || []).find((m) => m.moduleCode === code) || { moduleCode: code, moduleName: code };
    const metric = metricsByCode.get(code) || {};
    const data = state.mvpData?.[code] || {};
    return `<details open class="intake-module"><summary>${esc(code)} — ${esc(module.moduleName)} <span class="summary-pill">${esc(metric.completenessPct ?? 0)}% complete</span></summary>
      <div class="module-intro">
        <p><strong>${esc(spec.priority)}</strong> — ${esc(spec.purpose)}</p>
        ${renderIntakeChecklist(spec)}
        ${spec.guidanceCards?.length ? `<div class="guidance-cards">${spec.guidanceCards.map((card) => `<div class="guidance-card"><strong>${esc(card.title)}</strong><p>${esc(card.body)}</p></div>`).join("")}</div>` : ""}
      </div>
      ${renderScalarIntakeFields(code, spec, data)}
      ${(spec.collections || []).map((collection) => {
        const rows = Array.isArray(data[collection.key]) ? data[collection.key] : [];
        const needsResident = (collection.fields || []).some((fieldDef) => fieldDef.relation === "resident");
        const residentDependency = needsResident && !getResidentOptions().length ? `<p class="dependency-note">Add the resident in M5 Residents first. Once added, you can select them here by name.</p>` : "";
        return `<section class="collection-block"><div class="row-between"><h4>${esc(collection.label)}</h4><span class="badge badge-info">${rows.length} record(s)</span></div>${residentDependency}${renderRecordForm(code, collection)}${renderRecordTable(code, collection, rows)}</section>`;
      }).join("")}
    </details>`;
  }).join("");
}

function renderModules() {
  const { M1: m1 = {}, M2: m2 = {}, M3: m3 = {}, M4: m4 = {}, M17: m17 = {} } = state.mvpData || {};
  return `
    <h2>Facility DNA Workspace</h2>
    <p class="lead">This is now the complete onboarding intake: residents, rates, care, rounds, staffing, meds, dining, activities, maintenance, admissions, family portal, incidents, vendors, reporting, documents, employees, rooms, and facility/legal DNA.</p>
    ${renderIntakeCoverageSummary()}
    <details open><summary>M1 — Company / Portfolio</summary><div class="grid2">
      ${input({ label: "Parent legal name", "data-mvp": "M1", "data-field": "parentLegalName", value: m1.parentLegalName })}
      ${input({ label: "DBA", "data-mvp": "M1", "data-field": "dba", value: m1.dba })}
      ${input({ label: "Operating LLC", "data-mvp": "M1", "data-field": "operatingLlc", value: m1.operatingLlc, hint: "Distinct from property-holding entity." })}
      ${input({ label: "Property LLC", "data-mvp": "M1", "data-field": "propertyLlc", value: m1.propertyLlc })}
      ${input({ label: "Mailing address", "data-mvp": "M1", "data-field": "mailingAddress", value: m1.mailingAddress })}
      ${input({ label: "Corporate contact", "data-mvp": "M1", "data-field": "corporateContact", value: m1.corporateContact })}
      ${input({ label: "Billing contact", "data-mvp": "M1", "data-field": "billingContact", value: m1.billingContact })}
      ${input({ label: "Time zone", "data-mvp": "M1", "data-field": "timeZone", value: m1.timeZone })}
    </div></details>
    <details open><summary>M2 — Facility Profile</summary><div class="grid2">
      ${input({ label: "Legal name", "data-mvp": "M2", "data-field": "legalName", value: m2.legalName })}
      ${input({ label: "DBA", "data-mvp": "M2", "data-field": "dba", value: m2.dba })}
      ${input({ label: "Facility type", "data-mvp": "M2", "data-field": "facilityType", value: m2.facilityType })}
      ${input({ label: "License number", "data-mvp": "M2", "data-field": "licenseNumber", value: m2.licenseNumber })}
      ${input({ label: "License state", "data-mvp": "M2", "data-field": "licenseState", value: m2.licenseState })}
      ${input({ label: "License agency", "data-mvp": "M2", "data-field": "licenseAgency", value: m2.licenseAgency })}
      ${input({ label: "License expiration", type: "date", "data-mvp": "M2", "data-field": "licenseExpiration", value: m2.licenseExpiration })}
      ${input({ label: "Physical operating address", "data-mvp": "M2", "data-field": "physicalAddress", value: m2.physicalAddress || m2.facilityAddress })}
      ${input({ label: "Mailing address", "data-mvp": "M2", "data-field": "mailingAddress", value: m2.mailingAddress })}
      ${input({ label: "Main phone", "data-mvp": "M2", "data-field": "mainPhone", value: m2.mainPhone })}
      ${input({ label: "After-hours phone", "data-mvp": "M2", "data-field": "afterHoursPhone", value: m2.afterHoursPhone })}
      ${input({ label: "Licensed capacity", type: "number", "data-mvp": "M2", "data-field": "capacity", value: m2.capacity })}
      ${input({ label: "Floors/wings", "data-mvp": "M2", "data-field": "floorsWings", value: m2.floorsWings })}
      ${input({ label: "Executive Director", "data-mvp": "M2", "data-field": "executiveDirector", value: m2.executiveDirector })}
      ${input({ label: "DON / Resident Care", "data-mvp": "M2", "data-field": "don", value: m2.don })}
      ${input({ label: "Maintenance", "data-mvp": "M2", "data-field": "maintenanceDirector", value: m2.maintenanceDirector })}
      ${input({ label: "Business Office", "data-mvp": "M2", "data-field": "businessOfficeManager", value: m2.businessOfficeManager })}
      ${input({ label: "Emergency contact", "data-mvp": "M2", "data-field": "emergencyContact", value: m2.emergencyContact })}
      <label class="field checkbox"><span>Operating address confirmed</span><input type="checkbox" data-mvp="M2" data-field="operatingAddressConfirmed" ${m2.operatingAddressConfirmed ? "checked" : ""}/><small>Required because evidence shows management/mailing address patterns.</small></label>
    </div></details>
    <details open><summary>M3 — Rooms / Beds / Units</summary>
      <div class="grid2">${input({ label: "Beds total", type: "number", "data-mvp": "M3", "data-field": "bedsTotal", value: m3.bedsTotal })}${input({ label: "Units total", type: "number", "data-mvp": "M3", "data-field": "unitsTotal", value: m3.unitsTotal })}</div>
      <form id="m3-room-form" class="inline-form wrap"><input name="roomNumber" placeholder="Room #" required /><input name="floor" placeholder="Floor" /><input name="wing" placeholder="Wing" /><input name="unitType" placeholder="Unit type" /><input name="bedCount" type="number" placeholder="Beds" /><input name="careDesignation" placeholder="Care designation" /><select name="status"><option>active</option><option>offline</option><option>reserved</option></select><button type="submit">Add room</button></form>
      <div class="table-wrap"><table><thead><tr><th>Room</th><th>Floor</th><th>Wing</th><th>Type</th><th>Beds</th><th>Care</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(m3.rooms || []).map((r) => `<tr>${renderEditableRecordCells("M3", "rooms", r, [{ key: "roomNumber", label: "Room" }, { key: "floor", label: "Floor" }, { key: "wing", label: "Wing" }, { key: "unitType", label: "Type" }, { key: "bedCount", label: "Beds", type: "number" }, { key: "careDesignation", label: "Care" }, { key: "status", label: "Status" }])}<td><button type="button" class="danger-button" data-record-delete data-record-module="M3" data-record-collection="rooms" data-record-id="${esc(r.id || "")}">Delete</button></td></tr>`).join("") || "<tr><td colspan='8'>No rooms yet — add one representative room/unit to prove the capture model.</td></tr>"}</tbody></table></div>
    </details>
    <details open><summary>M4 — Employees / Users / Roles</summary>
      ${textarea({ label: "Role coverage notes", "data-mvp": "M4", "data-field": "roleCoverageNotes", value: m4.roleCoverageNotes, hint: "Explain launch coverage for ED/DON/Maintenance/Business Office/app roles." })}
      <form id="m4-employee-form" class="inline-form wrap"><input name="fullLegalName" placeholder="Full legal name" required /><input name="preferredName" placeholder="Preferred" /><input name="emailOrMobile" placeholder="Email/mobile" /><input name="hireDate" type="date" /><select name="employmentStatus"><option>active</option><option>inactive</option><option>terminated</option></select><input name="jobTitle" placeholder="Job title" /><input name="appRole" placeholder="App role" required /><input name="primaryFacility" placeholder="Primary facility" value="Homewood Lodge ALF" /><input name="shiftDepartment" placeholder="Shift/department" /><input name="supervisor" placeholder="Supervisor" /><input name="credentialSummary" placeholder="Credential summary" /><select name="loginStatus"><option>pending</option><option>active</option><option>disabled</option></select><button type="submit">Add employee</button></form>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Preferred</th><th>Contact</th><th>Status</th><th>Job Title</th><th>App Role</th><th>Shift</th><th>Supervisor</th><th>Credential</th><th>Login</th><th>Actions</th></tr></thead><tbody>${(m4.employees || []).map((e) => `<tr>${renderEditableRecordCells("M4", "employees", e, [{ key: "fullLegalName", label: "Name" }, { key: "preferredName", label: "Preferred" }, { key: "emailOrMobile", label: "Contact" }, { key: "employmentStatus", label: "Status" }, { key: "jobTitle", label: "Job Title" }, { key: "appRole", label: "App Role" }, { key: "shiftDepartment", label: "Shift" }, { key: "supervisor", label: "Supervisor" }, { key: "credentialSummary", label: "Credential" }, { key: "loginStatus", label: "Login" }])}<td><button type="button" class="danger-button" data-record-delete data-record-module="M4" data-record-collection="employees" data-record-id="${esc(e.id || "")}">Delete</button></td></tr>`).join("") || "<tr><td colspan='11'>No employees yet — add a representative launch user to show role/credential/login readiness.</td></tr>"}</tbody></table></div>
    </details>
    <details open><summary>M17 — Documents / Insurance / Compliance</summary>
      ${textarea({ label: "Review notes", "data-mvp": "M17", "data-field": "reviewNotes", value: m17.reviewNotes })}
      <p class="small-muted">M17 metadata is edited in Document Intake and drives source-of-truth, currency, custodian approval, and Gate 2 trust.</p>
    </details>
    ${renderOperationalIntakeModules()}
  `;
}

function formatArtifactLabel(value = "") {
  return String(value || "other").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderDetectionCard(intelligence, options = {}) {
  if (!intelligence) {
    return `
      <div class="doc-detected-card empty">
        <strong>Drop or choose a document.</strong>
        <p>The launch center will classify it, pre-fill the metadata, route it to the right module(s), and show what still needs human confirmation.</p>
      </div>
    `;
  }
  const confidence = intelligence.confidence || "low";
  const routes = intelligence.mappedModuleCodes || [];
  return `
    <div class="doc-detected-card">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Detected facts ${options.saved ? "saved" : "ready for review"}</p>
          <h3>${esc(formatArtifactLabel(intelligence.artifactType))} · ${esc(intelligence.entityAssociation)}</h3>
        </div>
        <span class="confidence-pill confidence-${esc(confidence)}">${esc(confidence)} confidence</span>
      </div>
      <div class="detected-grid">
        <span><strong>Term</strong>${esc(intelligence.term || "Needs confirmation")}</span>
        <span><strong>Currency</strong>${esc(intelligence.currencyStatus || "unknown")}</span>
        <span><strong>Source group</strong>${esc(intelligence.groupName || intelligence.documentGroupId || "New group")}</span>
        <span><strong>Routes</strong>${routes.map((code) => `<b>${esc(code)}</b>`).join(" ") || "M17"}</span>
      </div>
      <p class="small-muted"><strong>Why suggested:</strong> ${esc(intelligence.notes || "Matched filename and document metadata heuristics.")}</p>
      <p class="small-muted"><strong>Human checkpoint:</strong> review the highlighted auto-filled fields, then save. In production this same panel becomes the OCR/AI extraction review queue before facts are pushed into modules.</p>
    </div>
  `;
}

function renderSupabasePipelinePanel() {
  const config = loadPipelineConfig();
  const configured = pipelineConfigured(config);
  return `
    <div class="supabase-pipeline-panel ${configured ? "connected" : ""}">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Storage mode</p>
          <h3>${configured ? "Supabase OCR/AI connected" : "Local draft workbook — not auto-writing module answers to Supabase yet"}</h3>
          <p class="small-muted"><strong>Plain English:</strong> the answers typed in this Facility Launch page are saved in this browser so the onboarding team can finish the roundtable, export the JSON/markdown, and hand it back for import. The production Supabase parser is built and deployed, but this standalone page needs an authenticated Haven/Supabase session before it can upload documents or write approved facts into Supabase.</p>
        </div>
        <span class="confidence-pill ${configured ? "confidence-high" : "confidence-medium"}">${configured ? "connected" : "local draft"}</span>
      </div>
      <div class="approval-flow">
        <span>Current form entries: browser local draft</span><span>Export creates JSON/markdown handoff</span><span>Connected mode: Storage → OCR/AI → human approval → provenance write</span>
      </div>
      <details class="pipeline-config-details">
        <summary>Advanced: connect Supabase OCR/AI pipeline when logged into Haven</summary>
        <p class="small-muted"><strong>Do not enter real tokens during a screen-shared meeting.</strong> These fields are masked and are only for authenticated Haven testing.</p>
        <div class="grid2 compact-config">
          <input data-pipeline-config="supabaseUrl" placeholder="Supabase URL" value="${esc(config.supabaseUrl || "")}" />
          <input data-pipeline-config="anonKey" type="password" autocomplete="off" placeholder="Supabase anon key" value="${esc(config.anonKey || "")}" />
          <input data-pipeline-config="accessToken" type="password" autocomplete="off" placeholder="Current user JWT / access token" value="${esc(config.accessToken || "")}" />
          <input data-pipeline-config="organizationId" placeholder="Organization UUID" value="${esc(config.organizationId || "")}" />
          <input data-pipeline-config="facilityId" placeholder="Facility UUID (optional but recommended)" value="${esc(config.facilityId || "")}" />
          <button type="button" data-save-pipeline-config>Save Supabase connection</button>
        </div>
      </details>
      ${pipelineMessage ? `<div class="save-callout">${esc(pipelineMessage)}</div>` : ""}
    </div>
  `;
}

function renderDocumentsLaunchNeeds(docs, groups) {
  const stale = docs.filter((doc) => doc.currencyStatus === "stale");
  const pendingApproval = docs.filter((doc) => doc.custodianApprovalStatus !== "approved");
  const unresolvedGroups = groups.filter((group) => (group.documentIds || []).length > 1 && !group.sourceOfTruthDocumentId);
  const missing = [];
  if (!docs.length) missing.push("Upload core evidence: license, GL certificate, property policy, bond, loss runs, floor plan, emergency/vendor documents.");
  if (stale.length) missing.push(`${stale.length} stale document(s) need a refreshed file, route owner, or exception.`);
  if (pendingApproval.length) missing.push(`${pendingApproval.length} document(s) still need custodian approval.`);
  if (unresolvedGroups.length) missing.push(`${unresolvedGroups.length} duplicate/variant group(s) need source-of-truth selection.`);
  if (!docs.some((doc) => (doc.mappedModuleCodes || []).includes("M16"))) missing.push("Claims/risk evidence has not been routed to M16 yet.");
  if (!docs.some((doc) => (doc.mappedModuleCodes || []).includes("M18"))) missing.push("Vendor/emergency evidence has not been routed to M18 yet.");
  return `
    <div class="doc-needs-panel">
      <h3>What document intake still needs</h3>
      <ul>${(missing.length ? missing : ["Document intake has source-of-truth, currency, routing, and approval coverage for demo launch."]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function markAutoFilledFields(form) {
  form?.querySelectorAll("[data-auto-field]").forEach((control) => {
    control.classList.toggle("auto-filled", Boolean(control.value));
  });
}

function applyDocumentIntelligenceToForm(form, fileName) {
  if (!form || !fileName) return;
  const intelligence = inferDocumentIntelligence(fileName);
  for (const [name, value] of Object.entries({
    title: intelligence.title,
    artifactType: intelligence.artifactType,
    entityAssociation: intelligence.entityAssociation,
    term: intelligence.term,
    effectiveDate: intelligence.effectiveDate,
    expirationDate: intelligence.expirationDate,
    currencyStatus: intelligence.currencyStatus,
    version: intelligence.version,
    custodianApprovalStatus: intelligence.custodianApprovalStatus,
    confidence: intelligence.confidence,
    notes: intelligence.notes,
    documentGroupId: intelligence.documentGroupId,
    groupName: intelligence.groupName,
    mappedModuleCodes: intelligence.mappedModuleCodes.join(",")
  })) {
    const control = form.querySelector(`[name='${name}']`);
    if (control) control.value = value || "";
  }
  markAutoFilledFields(form);
  const preview = document.getElementById("doc-intelligence-preview");
  if (preview) preview.innerHTML = renderDetectionCard(intelligence);
}

function renderDocs() {
  const groups = state.documentGroups || [];
  const docs = state.documents || [];
  const unresolvedGroups = groups.filter((g) => (g.documentIds || []).length > 1 && !g.sourceOfTruthDocumentId);
  return `
    <h2>Document Intake + Source-of-Truth Resolver</h2>
    <p class="lead">Drop a document here first. The launch center classifies what it appears to be, pre-fills the launch metadata, routes it to the affected modules, flags stale/duplicate evidence, and immediately updates readiness after save. Current demo automation is filename/metadata based; production extraction should add Supabase Storage + OCR/AI parsing + human approval before facts write into modules.</p>
    ${lastDocumentSaveSummary ? `<div class="save-callout">${esc(lastDocumentSaveSummary)}</div>` : ""}
    ${renderSupabasePipelinePanel()}
    ${renderDocumentsLaunchNeeds(docs, groups)}
    ${unresolvedGroups.length ? `<div class="source-resolver-banner"><strong>Source-of-truth needed:</strong> ${unresolvedGroups.map((group) => esc(group.name)).join(", ")}. Select the canonical document below before Gate 2.</div>` : ""}
    <form id="document-form" class="grid2 intake-card doc-upload-card">
      <label class="doc-drop-zone" for="doc-file-input">
        <input id="doc-file-input" type="file" name="file" />
        <span class="drop-icon">📄</span>
        <strong>Drop a PDF or choose file</strong>
        <small>Auto-detects type, entity, dates, duplicate group, and module route.</small>
      </label>
      <input name="title" placeholder="Document title (auto-filled from file name)" required data-auto-field />
      <select name="artifactType" data-auto-field>${ARTIFACT_TYPES.map((v) => option(v, "gl_cert")).join("")}</select>
      <input name="entityAssociation" placeholder="Facility/entity association" value="Homewood Lodge ALF" data-auto-field />
      <input name="term" placeholder="Term/year" data-auto-field />
      <input name="effectiveDate" type="date" data-auto-field />
      <input name="expirationDate" type="date" data-auto-field />
      <select name="currencyStatus" data-auto-field>${CURRENCY_STATUSES.map((v) => option(v, "unknown")).join("")}</select>
      <input name="version" placeholder="Version" value="v1" data-auto-field />
      <select name="custodianApprovalStatus" data-auto-field>${APPROVAL_STATUSES.map((v) => option(v, "pending")).join("")}</select>
      <select name="confidence" data-auto-field>${CONFIDENCE_LEVELS.map((v) => option(v, "manual")).join("")}</select>
      <input name="notes" placeholder="Confidence notes" data-auto-field />
      <input type="hidden" name="documentGroupId" />
      <input type="hidden" name="groupName" />
      <input type="hidden" name="mappedModuleCodes" />
      <div id="doc-intelligence-preview" class="doc-intelligence-preview">${renderDetectionCard(null)}</div>
      <button type="submit">Confirm and save classified document</button>
      <button type="button" class="secondary-button" data-supabase-ocr-upload>Upload to Supabase OCR/AI pipeline</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Document</th><th>Artifact</th><th>Facility/Entity</th><th>Term</th><th>Effective</th><th>Expiration</th><th>Version</th><th>Currency</th><th>Approval</th><th>Confidence/Notes</th><th>Route/Exception</th><th>Actions</th></tr></thead><tbody>
      ${docs.map((d) => `<tr>
        <td><strong>${esc(d.title)}</strong><br><small>${d.isSourceOfTruth ? "Source of truth" : "variant/intake"}</small>${d.mappedModuleCodes?.length ? `<br><span class="route-chip-row">${d.mappedModuleCodes.map((code) => `<b>${esc(code)}</b>`).join(" ")}</span>` : ""}${d.automationSummary ? `<br><small>${esc(d.automationSummary)}</small>` : ""}</td>
        <td><select data-doc-field="artifactType" data-doc-id="${d.id}">${ARTIFACT_TYPES.map((v) => option(v, d.artifactType)).join("")}</select></td>
        <td><input data-doc-field="entityAssociation" data-doc-id="${d.id}" value="${esc(d.entityAssociation || d.facilityName || "")}" /></td>
        <td><input data-doc-field="term" data-doc-id="${d.id}" value="${esc(d.term || "")}" /></td>
        <td><input type="date" data-doc-field="effectiveDate" data-doc-id="${d.id}" value="${esc(d.effectiveDate || "")}" /></td>
        <td><input type="date" data-doc-field="expirationDate" data-doc-id="${d.id}" value="${esc(d.expirationDate || "")}" /></td>
        <td><input data-doc-field="version" data-doc-id="${d.id}" value="${esc(d.version || "")}" /></td>
        <td><select data-doc-field="currencyStatus" data-doc-id="${d.id}">${CURRENCY_STATUSES.map((v) => option(v, d.currencyStatus)).join("")}</select>${currencyBadge(d.currencyStatus)}</td>
        <td><select data-doc-field="custodianApprovalStatus" data-doc-id="${d.id}">${APPROVAL_STATUSES.map((v) => option(v, d.custodianApprovalStatus)).join("")}</select></td>
        <td><select data-doc-field="confidence" data-doc-id="${d.id}">${CONFIDENCE_LEVELS.map((v) => option(v, d.confidence)).join("")}</select><input data-doc-field="notes" data-doc-id="${d.id}" value="${esc(d.notes || "")}" /></td>
        <td>${d.currencyStatus === "stale" ? `<input data-route-doc="${d.id}" placeholder="Route owner" value="${esc(d.routedOwnerName || "")}" /><button data-doc-exception="${d.id}">Request Exception</button>` : "No stale action"}</td>
        <td><button type="button" class="danger-button" data-doc-delete="${esc(d.id)}">Delete</button></td>
      </tr>`).join("") || "<tr><td colspan='12'>No documents entered yet — upload a license, insurance certificate, policy, bond, loss run, floor plan, or emergency/vendor document to start source-of-truth resolution.</td></tr>"}
    </tbody></table></div>
    <h3>Duplicate / Variant Groups</h3>
    <div class="cards">${groups.filter((g) => (g.documentIds || []).length > 1).map((g) => `<div class="card"><h4>${esc(g.name)}</h4><p>${g.sourceOfTruthDocumentId ? "Resolved" : "Unresolved"}</p><select data-sot-group="${g.id}"><option value="">Select source of truth</option>${g.documentIds.map((id) => {
      const d = docs.find((x) => x.id === id);
      return `<option value="${id}" ${g.sourceOfTruthDocumentId === id ? "selected" : ""}>${esc(d?.title || id)}</option>`;
    }).join("")}</select><small>Only documents in this group are accepted.</small></div>`).join("")}</div>
  `;
}

function renderExceptions() {
  const rows = (state.exceptions || []).map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.scopeType)}:${esc(e.scopeId)}</td><td>${esc(e.description || "")}</td><td>${statusBadge(e.status)}</td><td>${esc(e.ownerName || "")}</td><td>${esc(e.approverName || "")} ${e.approverRole ? `(${esc(e.approverRole)})` : ""}</td><td>${e.status === "requested" ? `<input data-ex-name="${e.id}" placeholder="Approver name" /><input data-ex-role="${e.id}" placeholder="Approver role" /><button data-ex-approve="${e.id}">Approve</button>` : ""} ${e.status !== "closed" ? `<button data-ex-close="${e.id}">Close</button>` : ""}</td></tr>`).join("");
  return `
    <h2>Exceptions</h2>
    <p class="lead">Exceptions are explicit launch waivers with approver name, role, and decision history captured for the onboarding record.</p>
    <form id="exception-form" class="grid2">
      <label class="field"><span>What are we creating an exception for?</span><select name="scopeType" required><option value="document">A specific document</option><option value="module">An onboarding module</option><option value="rule">A rule or policy</option></select><small>Choose the type first. Use the exact module code (M16) or document title/id in the next field.</small></label>
      <label class="field"><span>Which document, module, or rule?</span><input name="scopeId" placeholder="Example: M16 or HOMEWOOD GL CERT.pdf" required /><small>For a module, enter M1–M19. For a document, enter the document title shown in Document Intake.</small></label>
      <label class="field"><span>Who owns clearing this exception?</span><input name="ownerName" placeholder="Example: CFO, ED, DON, Document Custodian" required /></label>
      <label class="field"><span>Why is this exception acceptable for launch?</span><input name="description" placeholder="Example: Current COI requested from broker; CFO approves temporary launch exception." required /></label>
      <label class="field"><span>How serious is it?</span><select name="severity"><option value="major">Major — leadership approval needed</option><option value="minor">Minor — track and close</option><option value="blocking">Blocking — cannot launch until resolved or approved</option></select></label>
      <button type="submit">Add Exception</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Scope</th><th>Description</th><th>Status</th><th>Owner</th><th>Approval</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

function renderContradictions() {
  const rows = (state.contradictions || []).map((c) => `<tr>
    <td>${esc(c.id)}<br>${statusBadge(c.status)}</td>
    <td><select data-ctr-field="type" data-ctr-id="${c.id}">${["policy_reality_app", "document_document", "document_field", "entity_match", "currency", "ownership", "other"].map((v) => option(v, c.type)).join("")}</select><select data-ctr-field="severity" data-ctr-id="${c.id}">${["minor", "major", "blocking"].map((v) => option(v, c.severity)).join("")}</select></td>
    <td><textarea data-ctr-field="summary" data-ctr-id="${c.id}">${esc(c.summary)}</textarea></td>
    <td><textarea data-ctr-field="policyValue" data-ctr-id="${c.id}">${esc(c.policyValue || "")}</textarea></td>
    <td><textarea data-ctr-field="realityValue" data-ctr-id="${c.id}">${esc(c.realityValue || "")}</textarea></td>
    <td><textarea data-ctr-field="appSettingValue" data-ctr-id="${c.id}">${esc(c.appSettingValue || "")}</textarea></td>
    <td><input data-ctr-field="decisionOwner" data-ctr-id="${c.id}" value="${esc(c.decisionOwner || "")}" placeholder="Decision owner" /><input data-ctr-owner="${c.id}" value="${esc(c.ownerName || "")}" placeholder="Assigned owner" /></td>
    <td><textarea data-ctr-field="resolutionNotes" data-ctr-id="${c.id}" placeholder="Resolution notes">${esc(c.resolutionNotes || "")}</textarea></td>
    <td>${c.status === "open" ? `<button data-ctr-save-owner="${c.id}">Save Owner</button> <button data-ctr-resolve="${c.id}">Resolve</button>` : ""}</td>
  </tr>`).join("");
  return `
    <h2>Policy vs Reality Checks</h2>
    <p class="lead">Use this when policy, real-world practice, and app settings do not match. Each item needs an owner and a resolution before launch trust is complete.</p>
    <form id="contradiction-form" class="grid2">
      <select name="type"><option>policy_reality_app</option><option>document_document</option><option>other</option></select>
      <select name="severity"><option>major</option><option>minor</option><option>blocking</option></select>
      <input name="ownerName" placeholder="Assigned owner" />
      <input name="decisionOwner" placeholder="Decision owner" />
      <input name="summary" placeholder="Summary" required />
      <input name="policyValue" placeholder="Policy value" />
      <input name="realityValue" placeholder="Reality value" />
      <input name="appSettingValue" placeholder="App setting value" />
      <button type="submit">Add Contradiction</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Type/Severity</th><th>Summary</th><th>Policy</th><th>Reality</th><th>App Setting</th><th>Owners</th><th>Resolution</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>
  `;
}

function renderGatePanel(gateCode, evaluation) {
  const saved = (state.gates || []).find((g) => g.code === gateCode) || {};
  const signed = Boolean(saved.signedAt);
  const gateStatus = signed ? "SIGNED" : evaluation.pass ? "READY" : "BLOCKED";
  const signerRole = saved.requiredSignerRole || evaluation.requiredSignerRole || "Authorized signer";
  return `
    <div class="panel gate-panel">
      <div class="row-between"><h3>${gateCode} — ${gateStatus}</h3><span class="badge badge-info">Required signer: ${esc(signerRole)}</span></div>
      <ul class="criteria-list">
        ${evaluation.criteria.map((c) => `<li class="${c.pass ? "ok" : "fail"}"><strong>${c.pass ? "PASS" : "FAIL"}</strong> ${esc(c.label)} ${c.pass ? "" : `<small>${esc(c.blocker)}</small>`}</li>`).join("")}
      </ul>
      <div class="inline-form">
        <input data-gate-signer="${gateCode}" placeholder="Signer name" value="${esc(saved.signedBy || "")}" ${signed ? "disabled" : ""} />
        <input data-gate-role="${gateCode}" placeholder="Signer role" value="${esc(saved.signedRole || signerRole)}" ${signed ? "disabled" : ""} />
        <button data-gate-sign="${gateCode}" ${!evaluation.pass || signed ? "disabled" : ""}>Sign ${gateCode}</button>
      </div>
      ${signed ? `<p class='small-muted'>Signed by ${esc(saved.signedBy)} (${esc(saved.signedRole)}) at ${esc(saved.signedAt)}</p>` : ""}
    </div>
  `;
}

function renderGates() {
  return `<h2>Gate Checks</h2><p class="lead">Gates are deterministic snapshots. Sign-off stores signer, role, timestamp, criteria, and approved exceptions relied upon.</p>${renderGatePanel("G0", evaluateGate0(state))}${renderGatePanel("G2", evaluateGate2(state))}`;
}

function renderPushToHavenPanel() {
  const config = loadPipelineConfig();
  const connected = pipelineConfigured(config);
  const ready = promotionConfigured(config);
  const buttonLabel = pushBusy
    ? (pushDryRun ? "Previewing..." : "Pushing...")
    : (pushDryRun ? "Preview capture (no writes)" : "Push to Haven (Capture + Promote)");
  const dryRunChecked = pushDryRun ? "checked" : "";
  const title = ready
    ? "Capture current intake and promote ready modules into Haven"
    : connected
      ? "Add facility id before promotion"
      : "Connect Supabase first (see Document Intake tab)";
  const guidance = ready
    ? "One click first writes the current Facility Launch state to <code>facility_launch_module_values</code>, then calls <code>facility-launch-promote</code> so ready modules become app-visible operational data. Partial promotion is expected; gaps stay queued."
    : connected
      ? "The import connection is saved, but promotion requires a facility id so Haven knows which operational facility to update."
      : "Enter Supabase URL, anon key, current user JWT, organization id, and facility id on the Document Intake tab before pushing.";

  return `
    <div class="supabase-pipeline-panel ${ready ? "connected" : ""}">
      <div class="row-between gap">
        <div>
          <p class="eyebrow">Push to Haven</p>
          <h3>${esc(title)}</h3>
          <p class="small-muted">${guidance}</p>
        </div>
        <span class="confidence-pill ${ready ? "confidence-high" : "confidence-medium"}">${ready ? "ready" : connected ? "facility id needed" : "not connected"}</span>
      </div>
      <div class="row-between gap">
        <label class="small-muted"><input type="checkbox" data-push-dry-run ${dryRunChecked} /> Preview only (dry-run — no writes)</label>
        <button type="button" data-push-to-haven ${ready && !pushBusy ? "" : "disabled"}>${esc(buttonLabel)}</button>
      </div>
      ${pushError ? `<div class="save-callout" style="border-color:#c0392b;background:#fff5f5">${esc(pushError)}</div>` : ""}
      ${pushResult ? renderPushResult(pushResult) : ""}
    </div>
  `;
}

function renderPushResult(result) {
  const captured = result.captured || result;
  const promoted = result.promoted || null;
  const captureWasDryRun = captured.mode === "dry_run" || captured.dry_run || result.dry_run;
  const captureSummary = `${captureWasDryRun ? "Capture dry-run" : "Captured"}: inserts=${captured.inserts || 0} updates=${captured.updates || 0} noop=${captured.noops || 0} (${captured.payload_count || 0} source-backed field${captured.payload_count === 1 ? "" : "s"})`;
  const gapRows = (captured.gap_report || []).map((g) => `<tr><td>${esc(g.module)}</td><td><span class="badge badge-${esc(g.status)}">${esc(g.status)}</span></td><td>${esc((g.missing_fields || []).join(", ") || "—")}</td></tr>`).join("");
  const changeRows = (captured.rows || [])
    .filter((r) => r.change !== "noop")
    .map((r) => `<tr><td>${esc(r.module_code)}</td><td>${esc(r.field_path)}</td><td><span class="badge badge-${r.change === "insert" ? "info" : "watch"}">${esc(r.change)}</span></td><td><code>${esc(r.preview)}</code></td></tr>`).join("");
  const skipped = (captured.skipped_modules || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const promotionRows = (promoted?.modules_promoted || []).map((m) => {
    const tables = (m.tables_touched || []).map((t) => `${t.table}: +${t.rows_created || 0}/~${t.rows_updated || 0}`).join("; ") || "—";
    const warnings = (m.warnings || []).length ? `<br><small><strong>Warnings:</strong> ${esc((m.warnings || []).join(" | "))}</small>` : "";
    const errors = (m.errors || []).length ? `<br><small><strong>Errors:</strong> ${esc((m.errors || []).join(" | "))}</small>` : "";
    const prerequisites = (m.prerequisites_unmet || []).length ? `<br><small><strong>Waiting for:</strong> ${esc((m.prerequisites_unmet || []).join(", "))}</small>` : "";
    return `<tr><td>${esc(m.module_code)}</td><td><span class="badge badge-${m.status === "promoted" ? "info" : m.status === "partial" ? "watch" : m.status === "failed" ? "fail" : "assigned"}">${esc(m.status)}</span></td><td>${esc(m.summary || "")}${warnings}${errors}${prerequisites}</td><td>${esc(tables)}</td></tr>`;
  }).join("");
  const promoteSummary = promoted
    ? `${promoted.mode === "dry_run" ? "Promotion dry-run" : "Promoted"}: ${promoted.summary || "No promotion summary returned."}${promoted.error ? ` Error: ${promoted.error}` : ""}`
    : "Promotion was not run.";
  const promotionGaps = (promoted?.gap_modules || []).map((moduleCode) => `<li>${esc(moduleCode)}</li>`).join("");
  return `
    <div class="save-callout"><strong>${esc(captureSummary)}</strong>${result.note ? `<br><small>${esc(result.note)}</small>` : ""}</div>
    <details open class="pipeline-config-details">
      <summary>Step 1 — Captured to intake table</summary>
      <div class="table-wrap compact-table">
        <table><thead><tr><th>Module</th><th>Field</th><th>Change</th><th>Preview</th></tr></thead>
        <tbody>${changeRows || "<tr><td colspan='4'>No capture changes</td></tr>"}</tbody></table>
      </div>
    </details>
    <details open class="pipeline-config-details">
      <summary>Step 2 — Promoted to live Haven app</summary>
      <div class="save-callout"><strong>${esc(promoteSummary)}</strong></div>
      <div class="table-wrap compact-table">
        <table><thead><tr><th>Module</th><th>Status</th><th>Summary</th><th>Tables</th></tr></thead>
        <tbody>${promotionRows || "<tr><td colspan='4'>No promotion modules returned</td></tr>"}</tbody></table>
      </div>
    </details>
    <details class="pipeline-config-details">
      <summary>Step 3 — Gaps remaining (${(captured.gap_report || []).length + (promoted?.gap_modules || []).length})</summary>
      <div class="table-wrap compact-table">
        <table><thead><tr><th>Module</th><th>Status</th><th>Missing fields</th></tr></thead>
        <tbody>${gapRows || "<tr><td colspan='3'>—</td></tr>"}</tbody></table>
      </div>
      ${promotionGaps ? `<p class="small-muted"><strong>Promotion modules without intake data:</strong></p><ul>${promotionGaps}</ul>` : ""}
    </details>
    ${skipped ? `<details class="pipeline-config-details"><summary>Skipped modules</summary><ul>${skipped}</ul></details>` : ""}
  `;
}

function renderExport() {
  return `
    <h2>Executive Export</h2>
    <p class="lead">Generate a markdown packet with launch narrative, signed gates, criteria snapshot, exceptions, source-of-truth decisions, contradictions, and recent decision log excerpts.</p>
    ${renderPushToHavenPanel()}
    <button id="generate-export">Generate Readiness Export</button>
    <h3>Markdown Readiness Summary</h3>
    <textarea id="export-markdown" rows="16" placeholder="Generate export..."></textarea>
    <h3>Technical Data Export (JSON)</h3>
    <textarea id="export-json" rows="16" placeholder="Generate export..."></textarea>
  `;
}

function renderView() {
  if (activeTab === "overview") viewEl.innerHTML = renderOverview();
  if (activeTab === "program") viewEl.innerHTML = renderProgram();
  if (activeTab === "worksheet") viewEl.innerHTML = renderWorksheet();
  if (activeTab === "readiness") viewEl.innerHTML = renderReadiness();
  if (activeTab === "modules") viewEl.innerHTML = renderModules();
  if (activeTab === "docs") viewEl.innerHTML = renderDocs();
  if (activeTab === "exceptions") viewEl.innerHTML = renderExceptions();
  if (activeTab === "contradictions") viewEl.innerHTML = renderContradictions();
  if (activeTab === "gates") viewEl.innerHTML = renderGates();
  if (activeTab === "export") viewEl.innerHTML = renderExport();
}

function decisionActionLabel(actionType = "") {
  const labels = {
    program_charter_updated: "Program Charter updated",
    owner_assignment_updated: "Module owner updated",
    module_intake_record_added: "Onboarding record added",
    module_intake_record_updated: "Onboarding record updated",
    module_intake_record_deleted: "Onboarding record deleted",
    mvp_data_updated: "Onboarding field updated",
    document_added: "Document added",
    document_updated: "Document updated",
    document_deleted: "Document deleted",
    exception_requested: "Exception requested",
    exception_approved: "Exception approved",
    exception_closed: "Exception closed",
    contradiction_added: "Policy/reality check added",
    contradiction_updated: "Policy/reality check updated",
    contradiction_resolved: "Policy/reality check resolved",
    gate_signed: "Gate signed",
    push_to_haven_previewed: "Push to Haven previewed",
    push_to_haven_applied: "Push to Haven applied",
    export_generated: "Readiness export generated"
  };
  return labels[actionType] || String(actionType || "Activity").replaceAll("_", " ");
}

function renderDecisionLog() {
  decisionLogEl.innerHTML = (state.decisionLog || []).slice(0, 20).map((d) => `<li><strong>${esc(decisionActionLabel(d.actionType))}</strong> — ${esc(d.summary)}</li>`).join("");
}

function render() {
  renderTabs();
  renderSummary();
  renderView();
  renderDecisionLog();
}

document.body.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    render();
    return;
  }

  const deleteRecord = e.target.closest("[data-record-delete]");
  if (deleteRecord) {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    state = deleteModuleRecord(state, deleteRecord.dataset.recordModule, deleteRecord.dataset.recordCollection, deleteRecord.dataset.recordId);
    render();
    return;
  }

  const deleteDoc = e.target.closest("[data-doc-delete]");
  if (deleteDoc) {
    if (!window.confirm("Delete this document row? This cannot be undone.")) return;
    state = deleteDocument(state, deleteDoc.dataset.docDelete);
    lastDocumentSaveSummary = "Document row deleted. Readiness and source-of-truth groups were recalculated.";
    render();
    return;
  }

  const savePipeline = e.target.closest("[data-save-pipeline-config]");
  if (savePipeline) {
    const config = Object.fromEntries(Array.from(document.querySelectorAll("[data-pipeline-config]")).map((input) => [input.dataset.pipelineConfig, input.value]));
    savePipelineConfig(config);
    pipelineMessage = "Supabase OCR/AI pipeline connection saved in this browser.";
    render();
    return;
  }

  const supabaseUpload = e.target.closest("[data-supabase-ocr-upload]");
  if (supabaseUpload) {
    const form = supabaseUpload.closest("form");
    const file = form?.querySelector("#doc-file-input")?.files?.[0];
    const title = form?.querySelector("[name='title']")?.value || file?.name || "Uploaded document";
    supabaseUpload.disabled = true;
    pipelineMessage = "Uploading to Supabase Storage, converting document text, and running parser job...";
    renderSummary();
    try {
      const result = await uploadDocumentToSupabasePipeline(file, { title });
      pipelineMessage = `Supabase OCR/AI complete. Document ${result.ingest.document_id} parsed with ${result.parsed.fact_count || 0} fact(s) waiting for human approval/provenance apply.`;
    } catch (error) {
      pipelineMessage = error instanceof Error ? error.message : "Supabase OCR/AI pipeline failed.";
    }
    render();
    return;
  }

  const approve = e.target.closest("[data-ex-approve]");
  if (approve) {
    const id = approve.dataset.exApprove;
    const name = document.querySelector(`[data-ex-name='${id}']`)?.value || "";
    const role = document.querySelector(`[data-ex-role='${id}']`)?.value || "";
    state = approveException(state, id, name, role);
    render();
    return;
  }

  const close = e.target.closest("[data-ex-close]");
  if (close) {
    state = closeException(state, close.dataset.exClose);
    render();
    return;
  }

  const resolve = e.target.closest("[data-ctr-resolve]");
  if (resolve) {
    const id = resolve.dataset.ctrResolve;
    const notes = document.querySelector(`[data-ctr-field='resolutionNotes'][data-ctr-id='${id}']`)?.value || "";
    const owner = document.querySelector(`[data-ctr-owner='${id}']`)?.value || "user";
    state = resolveContradiction(state, id, notes, owner);
    render();
    return;
  }

  const saveOwner = e.target.closest("[data-ctr-save-owner]");
  if (saveOwner) {
    const id = saveOwner.dataset.ctrSaveOwner;
    const input = document.querySelector(`[data-ctr-owner='${id}']`);
    state = assignContradictionOwner(state, id, input?.value || "");
    render();
    return;
  }

  const requestDocException = e.target.closest("[data-doc-exception]");
  if (requestDocException) {
    const docId = requestDocException.dataset.docException;
    state = addException(state, {
      scopeType: "document",
      scopeId: docId,
      ownerName: "Document Custodian",
      description: `Exception request for stale document ${docId}`,
      severity: "major"
    });
    render();
    return;
  }

  const signBtn = e.target.closest("[data-gate-sign]");
  if (signBtn) {
    const code = signBtn.dataset.gateSign;
    const signerInput = document.querySelector(`[data-gate-signer='${code}']`);
    const roleInput = document.querySelector(`[data-gate-role='${code}']`);
    const evaluation = code === "G0" ? evaluateGate0(state) : evaluateGate2(state);
    state = signGate(state, code, signerInput?.value || "", roleInput?.value || evaluation.requiredSignerRole, evaluation);
    render();
    return;
  }

  const pushBtn = e.target.closest("[data-push-to-haven]");
  if (pushBtn) {
    if (pushBusy) return;
    pushBusy = true;
    pushError = "";
    pushResult = null;
    renderView();
    try {
      const exportPayload = JSON.parse(buildStateJsonExport(state));
      const result = await pushAndPromoteStateToHaven(exportPayload, { dryRun: pushDryRun });
      pushResult = result;
      const captured = result.captured || {};
      const promoted = result.promoted || {};
      state = appendDecisionLog(state, {
        actionType: pushDryRun ? "push_to_haven_previewed" : "push_to_haven_applied",
        summary: `${pushDryRun ? "Previewed" : "Applied"} push to Haven — capture inserts=${captured.inserts || 0}, updates=${captured.updates || 0}, noop=${captured.noops || 0}; promotion=${promoted.summary || "not run"}.`,
        relatedType: "facility",
        relatedId: state.facility?.id || "facility"
      });
    } catch (err) {
      pushError = err instanceof Error ? err.message : "Push failed.";
    } finally {
      pushBusy = false;
      render();
    }
    return;
  }

  const doExport = e.target.closest("#generate-export");
  if (doExport) {
    const md = buildReadinessMarkdown(state);
    const json = buildStateJsonExport(state);
    const mdEl = document.getElementById("export-markdown");
    const jsonEl = document.getElementById("export-json");
    if (mdEl) mdEl.value = md;
    if (jsonEl) jsonEl.value = json;
    state = appendDecisionLog(state, {
      actionType: "export_generated",
      summary: "Generated executive markdown + JSON readiness export.",
      relatedType: "facility",
      relatedId: state.facility.id
    });
    renderDecisionLog();
  }
});

function refreshAfterDataChange() {
  renderSummary();
  if (["modules", "readiness", "gates", "export"].includes(activeTab)) renderView();
}

document.body.addEventListener("change", (e) => {
  const dryToggle = e.target.closest("[data-push-dry-run]");
  if (dryToggle) {
    pushDryRun = Boolean(dryToggle.checked);
    renderView();
    return;
  }

  const program = e.target.closest("[data-program]");
  if (program) {
    state = updateProgramField(state, program.dataset.program, program.value);
    renderSummary();
    return;
  }

  const threshold = e.target.closest("[data-threshold]");
  if (threshold) {
    state = updateProgramThreshold(state, threshold.dataset.threshold, threshold.value);
    renderSummary();
    return;
  }

  const ws = e.target.closest("[data-ws]");
  if (ws) {
    state = updateOwnerWorksheetRow(state, ws.dataset.code, { [ws.dataset.ws]: ws.value });
    renderSummary();
    return;
  }

  const mvp = e.target.closest("[data-mvp]");
  if (mvp) {
    const value = mvp.type === "checkbox" ? mvp.checked : mvp.value;
    state = updateMvpDataField(state, mvp.dataset.mvp, mvp.dataset.field, value);
    refreshAfterDataChange();
    return;
  }

  const recordField = e.target.closest("[data-record-field]");
  if (recordField) {
    state = updateModuleRecord(state, recordField.dataset.recordModule, recordField.dataset.recordCollection, recordField.dataset.recordId, enrichLinkedPayload({ [recordField.dataset.recordField]: recordField.value }));
    refreshAfterDataChange();
    return;
  }

  const docField = e.target.closest("[data-doc-field]");
  if (docField) {
    state = updateDocument(state, docField.dataset.docId, { [docField.dataset.docField]: docField.value });
    refreshAfterDataChange();
    return;
  }

  const ctrField = e.target.closest("[data-ctr-field]");
  if (ctrField) {
    state = updateContradiction(state, ctrField.dataset.ctrId, { [ctrField.dataset.ctrField]: ctrField.value });
    renderSummary();
    return;
  }

  const sot = e.target.closest("[data-sot-group]");
  if (sot && sot.value) {
    state = selectSourceOfTruthDocument(state, sot.dataset.sotGroup, sot.value);
    render();
    return;
  }

  const route = e.target.closest("[data-route-doc]");
  if (route) {
    state = routeStaleDocument(state, route.dataset.routeDoc, route.value);
    refreshAfterDataChange();
    return;
  }

  if (e.target.id === "doc-file-input") {
    const fileName = e.target.files?.[0]?.name || "";
    applyDocumentIntelligenceToForm(e.target.form, fileName);
  }
});

document.body.addEventListener("dragover", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  e.preventDefault();
  zone.classList.add("dragging");
});

document.body.addEventListener("dragleave", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  zone.classList.remove("dragging");
});

document.body.addEventListener("drop", (e) => {
  const zone = e.target.closest(".doc-drop-zone");
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove("dragging");
  const input = zone.querySelector("input[type='file']");
  if (!input || !e.dataTransfer?.files?.length) return;
  input.files = e.dataTransfer.files;
  applyDocumentIntelligenceToForm(input.form, input.files[0]?.name || "");
});

document.body.addEventListener("submit", (e) => {
  if (e.target.matches("[data-module-record-form]")) {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addModuleRecord(state, e.target.dataset.moduleCode, e.target.dataset.collectionKey, enrichLinkedPayload(Object.fromEntries(fd.entries())));
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "exception-form") {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addException(state, {
      scopeType: fd.get("scopeType"),
      scopeId: fd.get("scopeId"),
      ownerName: fd.get("ownerName"),
      description: fd.get("description"),
      severity: fd.get("severity")
    });
    render();
    return;
  }

  if (e.target.id === "contradiction-form") {
    e.preventDefault();
    const fd = new FormData(e.target);
    state = addContradiction(state, Object.fromEntries(fd.entries()));
    render();
    return;
  }

  if (e.target.id === "document-form") {
    e.preventDefault();
    const beforeScore = scoreFacility(state).facilityReadinessScore;
    const fd = new FormData(e.target);
    const file = fd.get("file");
    const title = String(fd.get("title") || file?.name || "document");
    state = addDocument(state, { ...Object.fromEntries(fd.entries()), mappedModuleCodes: String(fd.get("mappedModuleCodes") || "").split(",").filter(Boolean), fileName: file?.name || "" });
    const afterScore = scoreFacility(state).facilityReadinessScore;
    lastDocumentSaveSummary = `Saved ${title}. Readiness recalculated from ${beforeScore} to ${afterScore}. Routed modules: ${String(fd.get("mappedModuleCodes") || "M17") || "M17"}.`;
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "m3-room-form") {
    e.preventDefault();
    state = addM3Room(state, Object.fromEntries(new FormData(e.target).entries()));
    e.target.reset();
    render();
    return;
  }

  if (e.target.id === "m4-employee-form") {
    e.preventDefault();
    state = addM4Employee(state, Object.fromEntries(new FormData(e.target).entries()));
    e.target.reset();
    render();
  }
});

function isEmptyOnboardingShell(currentState) {
  const actionTypes = new Set((currentState.decisionLog || []).map((entry) => entry.actionType));
  const onlyShellActions = [...actionTypes].every((actionType) => ["empty_onboarding_initialized", "empty_onboarding_reset"].includes(actionType));
  return !currentState.ingestionManifest
    && (currentState.documents || []).length === 0
    && (currentState.documentGroups || []).length === 0
    && (currentState.ingestionGaps || []).length === 0
    && (currentState.ingestionReviewQueue || []).length === 0
    && (currentState.mvpData?.M3?.rooms || []).length === 0
    && onlyShellActions;
}

async function loadRound1Import({ actor = "system", actionType = "round1_real_import_loaded" } = {}) {
  try {
    const response = await fetch(ROUND1_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Round 1 state fetch failed: ${response.status}`);
    const importedState = await response.json();
    state = saveState(importedState);
    state = appendDecisionLog(state, {
      actor,
      actionType,
      summary: "Loaded generated Homewood Round 1 real onboarding state; no demo fixture data loaded.",
      relatedType: "facility",
      relatedId: state.facility?.id || "fac-homewood"
    });
    pipelineMessage = "Homewood Round 1 import loaded from generated real onboarding artifacts.";
    render();
    return true;
  } catch (error) {
    console.error(error);
    pipelineMessage = `Unable to load Round 1 import: ${error.message}`;
    render();
    return false;
  }
}

loadRound1Button?.addEventListener("click", async () => {
  await loadRound1Import({ actor: "user" });
});

resetButton.addEventListener("click", () => {
  state = resetState();
  state = appendDecisionLog(state, {
    actor: "user",
    actionType: "empty_onboarding_reset",
    summary: "Reset onboarding shell triggered; no demo fixture data loaded.",
    relatedType: "facility",
    relatedId: state.facility.id
  });
  render();
});

if (isEmptyOnboardingShell(state)) {
  loadRound1Import({ actor: "system", actionType: "round1_real_import_auto_loaded" });
} else {
  render();
}

