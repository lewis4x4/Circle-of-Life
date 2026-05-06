import { onboardingIntakeCatalog, createEmptyIntakeData, fullIntakeModuleCodes } from "./intakeCatalog.js";

export const STORAGE_KEY = "facilityLaunchCenter.homewood.v4";

const nowIso = new Date().toISOString();


const homewoodRooms = Array.from({ length: 20 }, (_, index) => {
  const roomNumber = String(index + 1);
  const isPrivate = index < 4;
  return {
    id: `room-homewood-${roomNumber}`,
    roomNumber,
    floor: "1",
    wing: "None — single floor",
    unitType: isPrivate ? "Private single" : "Companion double",
    bedCount: isPrivate ? 1 : 2,
    careDesignation: "Standard facility",
    status: "active",
    name: roomNumber
  };
});

export const moduleCatalog = [
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

const recommendedModuleOwners = {
  M1: ["CEO / CFO", "Executive / Finance", "Corporate legal/entity records"],
  M2: ["Executive Director", "Facility Leader", "License file and facility profile"],
  M3: ["Maintenance Director", "Physical Plant", "Room list / floor plan"],
  M4: ["Executive Director", "HR / Operations", "Employee roster and access list"],
  M5: ["Business Office Manager", "Resident Census", "Current census and face sheets"],
  M6: ["CFO / Business Office", "Billing / Finance", "Resident ledger and rate sheets"],
  M7: ["DON / Resident Care Director", "Clinical Operations", "Assessments and service plans"],
  M8: ["DON / Shift Leads", "Care Execution", "Rounds policy and staff interview"],
  M9: ["Executive Director", "Staffing", "Schedule and assignment sheet"],
  M10: ["DON", "Medication Process", "MAR/eMAR and pharmacy records"],
  M11: ["Dining Manager", "Dining / Dietary", "Dietary binder and meal schedule"],
  M12: ["Life Enrichment Director", "Activities", "Activity calendar and preferences"],
  M13: ["Maintenance Director", "Maintenance", "Asset list and work-order log"],
  M14: ["Sales / Admissions Director", "Admissions", "Inquiry pipeline and move-in checklist"],
  M15: ["Business Office Manager", "Family Portal", "Responsible-party contacts and consents"],
  M16: ["ED / DON / CFO", "Risk / Incidents", "Incident policy and loss-run awareness"],
  M17: ["Document Custodian", "Compliance Documents", "Insurance/compliance document binder"],
  M18: ["Maintenance / Business Office", "Vendors / Emergency", "Vendor binder and emergency contact list"],
  M19: ["COO", "Executive Reporting", "Launch scoreboard worksheet"]
};

const seededModules = moduleCatalog.map((m) => {
  const [ownerName, ownerTitle, source] = recommendedModuleOwners[m.moduleCode] || ["Assign owner", "", ""];
  return {
    ...m,
    scopeStatus: "in",
    ownerName,
    ownerTitle,
    source,
    dueDate: "2026-05-15",
    openQuestions: "",
    status: "assigned",
    nextAction: "Enter and validate this module in Onboarding Intake"
  };
});

const emptyOperationalIntakeData = Object.fromEntries(
  fullIntakeModuleCodes.map((code) => [code, createEmptyIntakeData(onboardingIntakeCatalog[code])])
);

export const seedState = {
  program: {
    id: "prog-homewood-mvp",
    name: "Homewood Facility Launch MVP",
    sponsor: "Executive Sponsor",
    deputySponsor: "Deputy Sponsor",
    cfo: "CFO",
    coo: "COO",
    onboarder: "Onboarder",
    documentCustodian: "Document Custodian",
    definitionOfLive: "Pilot is Live when all Facility DNA onboarding modules are complete, Gate 0/Gate 2 are signed, and source-of-truth decisions are exported.",
    homewoodScope: "Homewood Lodge ALF launch in scope; other facilities deferred from this wave.",
    thresholds: { moduleReadinessTarget: 95, staleMonths: 12, gate2FacilityScoreTarget: 90 },
    createdAt: nowIso
  },
  facility: {
    id: "fac-homewood",
    programId: "prog-homewood-mvp",
    name: "Homewood Lodge ALF",
    status: "pilot",
    pilotWarnings: [
      "Entity model unresolved until operating/property entities linked.",
      "Operating address confirmation required.",
      "Stale 2022/2021 documents present.",
      "Duplicate GL and property policy variants unresolved.",
      "Claims awareness route to CFO/Legal.",
      "Rounds cadence contradiction fixture open."
    ],
    linkedEntityIds: ["ent-homewood-property", "ent-ssb-operating"]
  },
  modules: seededModules,
  mvpData: {
    M1: {
      parentLegalName: "",
      dba: "",
      operatingLlc: "Sorensen, Smith & Bay LLC",
      propertyLlc: "Homewood Property Company LLC",
      mailingAddress: "",
      corporateContact: "",
      billingContact: "",
      timeZone: "America/New_York",
      legalEntities: [
        { id: "ent-homewood-property", name: "Homewood Property Company LLC", role: "property-holding" },
        { id: "ent-ssb-operating", name: "Sorensen, Smith & Bay LLC", role: "operating/related" }
      ],
      ambiguityCandidates: ["Sorensen Smith & Bay"]
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
      capacity: "36",
      floorsWings: "Single floor; no wings",
      executiveDirector: "",
      don: "",
      maintenanceDirector: "",
      businessOfficeManager: "",
      emergencyContact: "",
      operatingAddressConfirmed: false
    },
    M3: {
      rooms: homewoodRooms,
      bedsTotal: 36,
      unitsTotal: 20
    },
    M4: {
      employees: [],
      roleCoverageNotes: "COL roles confirmed: Administrator, Assistant, Cook, Medication Technician, Resident Aide, Housekeeping Aide. Universal-worker model is normal, but role-restricted hires must be supported. Employee lifecycle must capture application, background check, references, hire date, pre-service orientation before floor work, 30-day items, in-service confirmation, med-tech attestation, and non-compliance alerts to Administrator, Assistant, Michelle, and Jessica."
    },
    ...emptyOperationalIntakeData,
    M5: {
      ...emptyOperationalIntakeData.M5,
      censusDate: "2026-05-06",
      residentSource: "Pending Homewood document dump: face sheets, admit/discharge log, census records, AR sheet, Medicaid pending tracker, contract scans.",
      residentValidationOwner: "Business Office Manager / Jessica + William document dump"
    },
    M6: {
      ...emptyOperationalIntakeData.M6,
      billingSystemSource: "QuickBooks/customer ledger + resident contracts; QuickBooks Online API integration preferred pending Milton sign-off.",
      billingCycle: "Monthly; actual resident rates are individually negotiated under posted ceilings.",
      rateApprovalOwner: "CFO / Business Office",
      medicaidProviderRule: "Add Medicaid providers per facility. For Medicaid residents, combine contracted private amount plus Medicaid provider amount, capped at the posted room rate.",
      postedPrivateRoomRate: "5550",
      postedCompanionRoomRate: "4000"
    },
    M8: {
      ...emptyOperationalIntakeData.M8,
      roundingPolicySource: "COL response 2026-05-06: Haven owns rounds; Quickmar rounds disabled. Use med-cart resident split for staff assignments.",
      roundingDecisionOwner: "COO / DON",
      roundingExceptionProcess: "30-minute grace period. Enhanced checks can override standard cadence. Avoid duplicate narrative notes if Quickmar med-pass export already covers notes.",
      roundSchedules: [
        {
          id: "m8-homewood-day",
          roundName: "Homewood day-shift observation rounds",
          residentGroup: "All Homewood residents, divided by med-cart/staff assignment",
          shift: "Day Shift 6a-6p",
          cadence: "6:00a, 10:00a, 2:00p, 5:30p",
          startTime: "06:00",
          endTime: "18:00",
          taskList: "Fast location + activity dropdown capture; optional note/speech-to-text only when needed.",
          documentationRequired: "Location and activity required; narrative note optional to avoid duplicate Quickmar documentation.",
          missedRoundEscalation: "Grace period 30 minutes; escalate overdue rounds to shift lead/DON.",
          ownerRole: "Shift lead / Medication Technician"
        },
        {
          id: "m8-homewood-night",
          roundName: "Homewood night-shift safety rounds",
          residentGroup: "All Homewood residents, divided by med-cart/staff assignment",
          shift: "Night Shift 6p-6a",
          cadence: "Every 2 hours",
          startTime: "18:00",
          endTime: "06:00",
          taskList: "Minimal-disruption safety/location/activity check; do not wake residents unnecessarily.",
          documentationRequired: "Location and activity required; narrative note optional when condition or exception warrants.",
          missedRoundEscalation: "Grace period 30 minutes; escalate overdue rounds to shift lead/DON.",
          ownerRole: "Night shift lead"
        }
      ]
    },
    M10: {
      ...emptyOperationalIntakeData.M10,
      medicationScope: "Phase 1: Quickmar remains live MAR. Haven parses daily Quickmar export and displays meds/notes as of last sync. Phase 2: Haven native med module.",
      marSource: "Quickmar daily export to Drive folder",
      medicationOwner: "Administrator / Assistant; alerts to Administrator, Assistant, Michelle, Jessica if export missed."
    },
    M11: {
      ...emptyOperationalIntakeData.M11,
      mealSchedule: "Breakfast, lunch, dinner with ate/refused/out_of_facility status.",
      dietarySource: "Dietary logs + resident face sheet allergies. Snack contents deferred Phase 1.",
      diningOwner: "Facility staff / dietary owner; snack log must capture who passed snack and time."
    },
    M12: {
      ...emptyOperationalIntakeData.M12,
      activityCalendarSource: "Monthly activity calendar currently built by hand.",
      attendanceTrackingRule: "Track resident attendance, who conducted activity (facility staff, Home Health, Hospice, other), actual start time, and confirming initials.",
      activitiesOwner: "Activities owner / facility staff; alert Administrator, Assistant, Michelle, Jessica if two required daily activities are not completed."
    },
    M13: {
      ...emptyOperationalIntakeData.M13,
      workOrderSource: "Reactive work orders plus scheduled inspections/drills.",
      preventiveMaintenanceCadence: "Annual inspections, menus, permits, 6 fire drills/year, 2 elopement drills/year. Maintenance task catalog pending Terell intake.",
      maintenanceOwner: "Terell for maintenance task catalog; facility administrator for annual compliance follow-up."
    },
    M15: {
      ...emptyOperationalIntakeData.M15,
      familyPortalScope: "One-way Haven-to-family portal: activity attendance, billing, and admin/assistant notes. Families cannot reply.",
      communicationPolicy: "Only Administrator and Assistant can post family notes, e.g. called earlier / please return call. Use portal notes as documentation that family was notified.",
      portalOwner: "Administrator / Assistant / Business Office"
    },
    M17: {
      ...emptyOperationalIntakeData.M17,
      reviewNotes: "Seeded docs require source-of-truth selection and currency routing. Confirmed forms map: all five facilities require 1823; Plantation also requires service plan and community support plan. Homewood document dump still pending: face sheets, admit/discharge log, census, AR sheet, dietary logs, fire drill log, Medicaid pending tracker, contract scans."
    },
    M18: {
      ...emptyOperationalIntakeData.M18,
      vendorSource: "Pending vendor/emergency contact document dump and Terell maintenance intake.",
      afterHoursVendorRule: "Capture after-hours dispatch numbers, account numbers, contract status, vendor COI status, and escalation owner for each critical vendor.",
      vendorOwner: "Maintenance Director / Business Office"
    },
    M19: {
      ...emptyOperationalIntakeData.M19,
      executiveDashboardAudience: "CEO, CFO, COO, ED, DON / launch leadership",
      reportCadence: "Daily 9am huddle for first 30 days",
      kpiOwner: "COO — assembles daily launch scoreboard and chases missing data"
    }
  },
  documents: [
    {
      id: "doc-gl-1",
      title: "HOMEWOOD GL CERT.pdf",
      originalFilename: "HOMEWOOD GL CERT.pdf",
      artifactType: "gl_cert",
      documentGroupId: "grp-gl",
      isSourceOfTruth: false,
      currencyStatus: "stale",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Sorensen, Smith & Bay LLC",
      effectiveDate: "2022-01-01",
      expirationDate: "2023-01-01",
      term: "2022 GL coverage year",
      version: "v1",
      custodianApprovalStatus: "pending",
      confidence: "medium",
      notes: "Seeded stale duplicate candidate."
    },
    {
      id: "doc-gl-2",
      title: "HOMEWOOD GL CERT 2.pdf",
      originalFilename: "HOMEWOOD GL CERT 2.pdf",
      artifactType: "gl_cert",
      documentGroupId: "grp-gl",
      isSourceOfTruth: false,
      currencyStatus: "stale",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Sorensen, Smith & Bay LLC",
      effectiveDate: "2022-01-01",
      expirationDate: "2023-01-01",
      term: "2022 GL coverage year",
      version: "v2",
      custodianApprovalStatus: "pending",
      confidence: "medium",
      notes: "Variant copy; needs custodian decision."
    },
    {
      id: "doc-prop-1",
      title: "HOMEWOOD PROPERTY Policy.pdf",
      originalFilename: "HOMEWOOD PROPERTY Policy.pdf",
      artifactType: "property_policy",
      documentGroupId: "grp-prop",
      isSourceOfTruth: false,
      currencyStatus: "stale",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Homewood Property Company LLC",
      effectiveDate: "2022-01-01",
      expirationDate: "2023-01-01",
      term: "2022 property policy year",
      version: "v1",
      custodianApprovalStatus: "pending",
      confidence: "medium",
      notes: "Policy variant requiring source-of-truth selection."
    },
    {
      id: "doc-prop-2",
      title: "HOMEWOOD PROPERTY POLICY 2.pdf",
      originalFilename: "HOMEWOOD PROPERTY POLICY 2.pdf",
      artifactType: "property_policy",
      documentGroupId: "grp-prop",
      isSourceOfTruth: false,
      currencyStatus: "stale",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Homewood Property Company LLC",
      effectiveDate: "2022-01-01",
      expirationDate: "2023-01-01",
      term: "2022 property policy year",
      version: "v2",
      custodianApprovalStatus: "pending",
      confidence: "medium",
      notes: "Duplicate/variant policy copy."
    },
    {
      id: "doc-bond-1",
      title: "HOMEWOOD BOND CERTIFICATE.pdf",
      originalFilename: "HOMEWOOD BOND CERTIFICATE.pdf",
      artifactType: "bond_certificate",
      documentGroupId: "grp-bond",
      isSourceOfTruth: true,
      currencyStatus: "aging",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Sorensen, Smith & Bay LLC",
      effectiveDate: "2022-01-01",
      expirationDate: "2023-01-01",
      term: "2022 bond certificate",
      version: "v1",
      custodianApprovalStatus: "approved",
      confidence: "high",
      notes: "Aging but source-of-truth fixture."
    },
    {
      id: "doc-lossrun-1",
      title: "Smith & Sorensen Loss Run.pdf",
      originalFilename: "Smith & Sorensen Loss Run.pdf",
      artifactType: "loss_run",
      documentGroupId: "grp-lossrun",
      isSourceOfTruth: true,
      currencyStatus: "aging",
      facilityName: "Homewood Lodge ALF",
      entityAssociation: "Sorensen, Smith & Bay LLC",
      effectiveDate: "2021-01-01",
      expirationDate: "",
      term: "Loss run lookback",
      version: "v1",
      custodianApprovalStatus: "approved",
      confidence: "medium",
      notes: "Claims awareness route to CFO/Legal."
    }
  ],
  documentGroups: [
    { id: "grp-gl", name: "Homewood GL Coverage", artifactType: "gl_cert", documentIds: ["doc-gl-1", "doc-gl-2"], sourceOfTruthDocumentId: null },
    { id: "grp-prop", name: "Homewood Property Policy", artifactType: "property_policy", documentIds: ["doc-prop-1", "doc-prop-2"], sourceOfTruthDocumentId: null },
    { id: "grp-bond", name: "Homewood Bond Certificate", artifactType: "bond_certificate", documentIds: ["doc-bond-1"], sourceOfTruthDocumentId: "doc-bond-1" },
    { id: "grp-lossrun", name: "Homewood Loss Run", artifactType: "loss_run", documentIds: ["doc-lossrun-1"], sourceOfTruthDocumentId: "doc-lossrun-1" }
  ],
  gates: [
    { code: "G0", name: "Program Charter", status: "ready", blockers: [], requiredSignerRole: "Executive Sponsor" },
    { code: "G2", name: "Owner + Intake Readiness", status: "blocked", blockers: ["Unresolved duplicate source-of-truth groups", "Missing owner/source/due on some modules"], requiredSignerRole: "Executive Sponsor / COO" }
  ],
  exceptions: [
    {
      id: "exc-stale-doc-1",
      scopeType: "document",
      scopeId: "doc-bond-1",
      description: "Temporary stale document exception pending refreshed policy cycle.",
      severity: "major",
      ownerName: "Document Custodian",
      approverName: "",
      approverRole: "",
      status: "requested"
    }
  ],
  contradictions: [
    {
      id: "ctr-rounds-cadence-1",
      type: "policy_reality_app",
      severity: "major",
      summary: "Homewood rounds cadence differs across policy, interview reality, and app setting.",
      affectedModuleNumber: 8,
      affectedField: "roundsCadence",
      policyValue: "Night checks every 2 hours per policy binder.",
      realityValue: "Interview says memory-care wing uses hourly comfort rounds overnight.",
      appSettingValue: "App template currently configured for q4h overnight reminders.",
      decisionOwner: "COO",
      ownerName: "",
      resolutionNotes: "",
      status: "open"
    }
  ],
  decisionLog: [
    {
      id: "dec-seed-1",
      timestamp: nowIso,
      actor: "system",
      actionType: "data_reset",
      summary: "Seeded Homewood pilot fixture initialized; COL 2026-05-06 responses ingested into Homewood launch intake defaults.",
      relatedType: "facility",
      relatedId: "fac-homewood"
    }
  ]
};
