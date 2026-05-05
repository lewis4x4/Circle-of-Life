import { onboardingIntakeCatalog, createEmptyIntakeData, fullIntakeModuleCodes } from "./intakeCatalog.js";

export const STORAGE_KEY = "facilityLaunchCenter.homewood.v3";

const nowIso = new Date().toISOString();

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
  { moduleNumber: 19, moduleCode: "M19", moduleName: "Reports / Dashboards / KPIs", isMvpDetailed: true }
];

const seededModules = moduleCatalog.map((m) => ({
  ...m,
  scopeStatus: "in",
  ownerName: "Roundtable Owner",
  ownerTitle: "Department Lead",
  source: "Onboarding Roundtable Intake",
  dueDate: "2026-05-15",
  openQuestions: "",
  status: "assigned",
  nextAction: "Complete required data capture and validate source of truth"
}));

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
      dba: "",
      facilityType: "Assisted Living Facility",
      licenseNumber: "",
      licenseState: "",
      licenseAgency: "",
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
      reviewNotes: "Seeded docs require source-of-truth selection and currency routing."
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
      summary: "Seeded Homewood pilot fixture initialized.",
      relatedType: "facility",
      relatedId: "fac-homewood"
    }
  ]
};
