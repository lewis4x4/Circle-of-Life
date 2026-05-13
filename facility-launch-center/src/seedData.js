import { onboardingIntakeCatalog, createEmptyIntakeData, fullIntakeModuleCodes } from "./intakeCatalog.js";

export const STORAGE_KEY = "facilityLaunchCenter.homewood.v5";

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

export const emptyOnboardingState = {
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
