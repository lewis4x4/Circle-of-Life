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
    priority: "What happens when something goes wrong",
    purpose: "Define the incident types staff must report, how serious each event is, who gets notified, when state/claims/legal review is required, who investigates, and how follow-up is closed before launch.",
    guidanceCards: [
      {
        title: "How to complete this module",
        body: "Use one row per incident type. Pick the closest option first, then add short operating instructions: who, when, and what happens next."
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
      label: "Incident response rules by event type",
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
    priority: "Executive go-live visibility",
    purpose: "Lock the short list of numbers leadership will check every day for the first 30 days, who owns each number, where it comes from, and what we do when it slips. This is the launch scoreboard — not a BI spec. If a number isn't on this list, no one will look at it during go-live.",
    fields: [
      { key: "executiveDashboardAudience", label: "Who reviews these numbers", sampleValue: "CEO, CFO, COO, ED, DON" },
      { key: "reportCadence", label: "How often we review them", sampleValue: "Daily 9am huddle for first 30 days; weekly executive rollup after that" },
      { key: "kpiOwner", label: "Scoreboard owner", sampleValue: "COO — assembles the daily scoreboard and chases gaps" }
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
      label: "Numbers we'll watch at go-live",
      addLabel: "Add a number to watch",
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
        { key: "kpiName", label: "Number we're watching" },
        { key: "businessQuestion", label: "Why we watch it" },
        { key: "dataSource", label: "Where the number comes from" },
        { key: "owner", label: "Person on the hook" },
        { key: "refreshCadence", label: "How often it's updated" },
        { key: "target", label: "Steady-state target (after day 30)" },
        { key: "launchThreshold", label: "Day-1-to-30 floor (alert if below)" },
        { key: "audience", label: "Who sees this number" },
        { key: "actionIfOffTrack", label: "What we do if it slips" }
      ]
    }]
  }};

export const fullIntakeModuleCodes = Object.keys(onboardingIntakeCatalog);

export function createEmptyIntakeData(spec) {
  const data = {};
  for (const field of spec.fields || []) data[field.key] = field.defaultValue || "";
  for (const collection of spec.collections || []) data[collection.key] = [];
  return data;
}
