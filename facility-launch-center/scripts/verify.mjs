import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  }
};

const stateApi = await import("../src/state.js");
const scoring = await import("../src/scoring.js");
const gates = await import("../src/gates.js");
const exportsApi = await import("../src/export.js");
const documentIntelligence = await import("../src/documentIntelligence.js");
const { onboardingIntakeCatalog } = await import("../src/intakeCatalog.js");

function check(label, condition, detail = "") {
  assert.ok(condition, `${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
}

function gateCriterion(evaluation, label) {
  return evaluation.criteria.find((criterion) => criterion.label === label);
}

function approveScopedException(state, payload) {
  let next = stateApi.addException(state, payload);
  const created = next.exceptions.find(
    (exception) => exception.scopeType === payload.scopeType
      && exception.scopeId === payload.scopeId
      && exception.status === "requested"
  );
  assert.ok(created, `Expected created exception for ${payload.scopeType}:${payload.scopeId}`);
  return stateApi.approveException(next, created.id, payload.approverName || "Approver", payload.approverRole || "Authorized approver");
}

function fillM1(state) {
  let next = state;
  for (const [field, value] of Object.entries({
    parentLegalName: "Homewood Senior Living Holdings LLC",
    dba: "Homewood Lodge",
    operatingLlc: "Sorensen, Smith & Bay LLC",
    propertyLlc: "Homewood Property Company LLC",
    mailingAddress: "100 Homewood Way, Homewood, AL 35209",
    corporateContact: "Alex Morgan, Corporate Operations",
    billingContact: "Priya Shah, Billing Office",
    timeZone: "America/New_York"
  })) next = stateApi.updateMvpDataField(next, "M1", field, value);
  return next;
}

function fillM2(state) {
  let next = state;
  for (const [field, value] of Object.entries({
    legalName: "Homewood Lodge Assisted Living Facility",
    dba: "Homewood Lodge ALF",
    facilityType: "Assisted Living Facility",
    licenseNumber: "ALF-HOMEWOOD-001",
    licenseState: "AL",
    licenseAgency: "Alabama Department of Public Health",
    licenseExpiration: "2027-05-31",
    physicalAddress: "100 Homewood Way, Homewood, AL 35209",
    facilityAddress: "100 Homewood Way, Homewood, AL 35209",
    mailingAddress: "PO Box 100, Homewood, AL 35209",
    mainPhone: "205-555-0100",
    afterHoursPhone: "205-555-0199",
    capacity: "48",
    floorsWings: "2 floors / North and Memory Care wings",
    executiveDirector: "Dana Ellis",
    don: "Morgan Ray",
    maintenanceDirector: "Casey Dunn",
    businessOfficeManager: "Taylor Kim",
    emergencyContact: "Dana Ellis 205-555-0199",
    operatingAddressConfirmed: true
  })) next = stateApi.updateMvpDataField(next, "M2", field, value);
  return next;
}

function fillM3(state) {
  let next = stateApi.addM3Room(state, {
    roomNumber: "101",
    floor: "1",
    wing: "North",
    unitType: "Private AL",
    bedCount: "1",
    careDesignation: "Assisted Living",
    status: "active"
  });
  next = stateApi.updateMvpDataField(next, "M3", "bedsTotal", "48");
  next = stateApi.updateMvpDataField(next, "M3", "unitsTotal", "44");
  return next;
}

function fillM4(state) {
  let next = stateApi.updateMvpDataField(state, "M4", "roleCoverageNotes", "ED, DON, Maintenance, Business Office, and launch admin roles have named coverage for MVP.");
  next = stateApi.addM4Employee(next, {
    fullLegalName: "Jordan Blake",
    preferredName: "Jordan",
    emailOrMobile: "jordan.blake@example.com",
    hireDate: "2024-02-12",
    employmentStatus: "active",
    jobTitle: "Executive Director",
    appRole: "facility_admin",
    primaryFacility: "Homewood Lodge ALF",
    shiftDepartment: "Administration",
    supervisor: "COO",
    credentialSummary: "AL Administrator License AL-123 expires 2027-06-30",
    loginStatus: "active"
  });
  return next;
}

function fillOperationalIntakeModules(state) {
  let next = state;
  for (const [moduleCode, spec] of Object.entries(onboardingIntakeCatalog)) {
    for (const field of spec.fields || []) {
      next = stateApi.updateMvpDataField(next, moduleCode, field.key, field.sampleValue || `${field.label} captured`);
    }
    for (const collection of spec.collections || []) {
      const sampleRecord = { ...collection.sampleRecord };
      if ((collection.fields || []).some((field) => field.relation === "resident")) {
        sampleRecord.residentId = next.mvpData?.M5?.residents?.[0]?.id || sampleRecord.residentId;
      }
      next = stateApi.addModuleRecord(next, moduleCode, collection.key, sampleRecord);
    }
    next = stateApi.updateOwnerWorksheetRow(next, moduleCode, {
      status: "ready_for_review",
      nextAction: "Validate production import and sign launch readiness"
    });
  }
  return next;
}

// Technical P1: localStorage failures fall back safely instead of crashing.
const workingStorage = globalThis.localStorage;
const workingWarn = console.warn;
globalThis.localStorage = {
  getItem() { throw new Error("blocked read"); },
  setItem() { throw new Error("blocked write"); }
};
console.warn = () => {};
stateApi.saveState({ program: { name: "Fallback Probe" }, facility: {}, modules: [], documents: [], documentGroups: [], exceptions: [], contradictions: [], gates: [], decisionLog: [], mvpData: {} });
check("a) localStorage failure is guarded with in-memory fallback", stateApi.loadState().program.name === "Fallback Probe");
console.warn = workingWarn;
globalThis.localStorage = workingStorage;

let state = stateApi.resetState();
let gate0 = gates.evaluateGate0(state);
let gate2 = gates.evaluateGate2(state);
check("b) seeded Gate 0 is ready from editable charter fixture", gate0.pass === true, `${gate0.criteria.filter((c) => c.pass).length}/${gate0.criteria.length}`);
check("c) seeded Gate 2 starts blocked", gate2.pass === false, gate2.blockers.join(" | "));

state = stateApi.updateProgramField(state, "sponsor", "CEO Sponsor");
state = stateApi.updateProgramField(state, "deputySponsor", "Deputy COO");
state = stateApi.updateProgramField(state, "documentCustodian", "Compliance Custodian");
state = stateApi.updateProgramField(state, "homewoodScope", "Homewood Lodge ALF pilot; Eastside/Grand Cypress deferred.");
state = stateApi.updateProgramThreshold(state, "moduleReadinessTarget", "95");
gate0 = gates.evaluateGate0(state);
check("d) Program Setup / Charter edits update Gate 0", gate0.pass === true && state.program.sponsor === "CEO Sponsor" && state.program.thresholds.moduleReadinessTarget === 95);

const beforeInvalidSot = JSON.stringify(state.documentGroups.find((group) => group.id === "grp-gl"));
state = stateApi.selectSourceOfTruthDocument(state, "grp-gl", "doc-prop-1");
check("e) source-of-truth validation rejects document IDs outside the group", JSON.stringify(state.documentGroups.find((group) => group.id === "grp-gl")) === beforeInvalidSot);

state = stateApi.selectSourceOfTruthDocument(state, "grp-gl", "doc-gl-1");
state = stateApi.selectSourceOfTruthDocument(state, "grp-prop", "doc-prop-1");
check(
  "f) source-of-truth conflicts can be resolved",
  scoring.getUnresolvedDuplicateGroups(state).length === 0 && scoring.getInvalidSourceOfTruthGroups(state).length === 0
);

const inferredGl = documentIntelligence.inferDocumentIntelligence("HOMEWOOD GL CERT 2.pdf");
check("g0) document intelligence classifies GL certificates from filename", inferredGl.artifactType === "gl_cert" && inferredGl.mappedModuleCodes.includes("M17") && inferredGl.documentGroupId.includes("gl_cert"));
state = stateApi.addDocument(state, { fileName: "HOMEWOOD GL CERT 2026.pdf" });
const autoDoc = state.documents.find((doc) => doc.originalFilename === "HOMEWOOD GL CERT 2026.pdf");
check("g1) document upload can auto-fill classification metadata", autoDoc?.artifactType === "gl_cert" && autoDoc?.mappedModuleCodes?.includes("M17") && autoDoc?.confidence === "high", autoDoc?.automationSummary || "");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
check("g2) document intake UI exposes upload detection, confirmation, rescore, and delete controls", appSource.includes("doc-drop-zone") && appSource.includes("Detected facts") && appSource.includes("Readiness recalculated") && appSource.includes("data-doc-delete") && appSource.includes("data-supabase-ocr-upload") && appSource.includes("Production OCR/AI pipeline"));
const deleteDocState = stateApi.deleteDocument(state, autoDoc.id);
check("g3) document intake rows can be deleted and document groups recalculate", !deleteDocState.documents.some((doc) => doc.id === autoDoc.id) && !deleteDocState.documentGroups.some((group) => (group.documentIds || []).includes(autoDoc.id)));

state = stateApi.addDocument(state, {
  title: "HOMEWOOD 2026 LICENSE.pdf",
  fileName: "HOMEWOOD 2026 LICENSE.pdf",
  artifactType: "state_license",
  entityAssociation: "Homewood Lodge ALF",
  term: "2026 license year",
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  currencyStatus: "fresh",
  version: "v1",
  custodianApprovalStatus: "approved",
  confidence: "manual",
  notes: "Manual local file intake row; no parser used."
});
const intakeDoc = state.documents.find((doc) => doc.title === "HOMEWOOD 2026 LICENSE.pdf");
check("g) document upload/intake metadata row can be added locally", Boolean(intakeDoc) && intakeDoc.artifactType === "state_license" && intakeDoc.currencyStatus === "fresh");

for (const moduleCode of ["M15", "M16", "M17", "M18"]) {
  state = stateApi.updateOwnerWorksheetRow(state, moduleCode, {
    ownerName: "Launch Owner",
    ownerTitle: "Department Lead",
    source: "Roundtable Intake",
    dueDate: "2026-05-20",
    status: "in_progress",
    nextAction: "Review launch evidence"
  });
}
state = approveScopedException(state, {
  scopeType: "module",
  scopeId: "M19",
  ownerName: "Executive Sponsor",
  description: "M19 KPI dashboard ownership deferred for MVP Gate 2.",
  severity: "major",
  approverName: "Olivia COO",
  approverRole: "COO"
});
check(
  "h) owner worksheet status and missing owners can be filled or exception-approved",
  scoring.getModulesMissingCoverage(state.modules, state).length === 0
    && state.modules.find((module) => module.moduleCode === "M17")?.status === "in_progress"
);

state = fillM1(state);
const m1Score = scoring.scoreModule(state.modules.find((module) => module.moduleCode === "M1"), state);
check("i) M1 captures deeper company/entity Facility DNA", m1Score.completenessPct === 100 && state.mvpData.M1.operatingLlc !== state.mvpData.M1.propertyLlc, `M1 completeness=${m1Score.completenessPct}%`);

state = fillM2(state);
const m2Score = scoring.scoreModule(state.modules.find((module) => module.moduleCode === "M2"), state);
check("j) M2 captures deeper facility profile and operating-address confirmation", m2Score.completenessPct === 100 && state.mvpData.M2.operatingAddressConfirmed === true, `M2 completeness=${m2Score.completenessPct}%`);

state = fillM3(state);
let m3RoomId = state.mvpData.M3.rooms[0].id;
state = stateApi.updateModuleRecord(state, "M3", "rooms", m3RoomId, { wing: "West" });
check("k1) M3 room records can be edited inline", state.mvpData.M3.rooms[0].wing === "West");
state = stateApi.deleteModuleRecord(state, "M3", "rooms", m3RoomId);
check("k2) M3 room records can be deleted", state.mvpData.M3.rooms.length === 0);
state = fillM3(state);
const m3Score = scoring.scoreModule(state.modules.find((module) => module.moduleCode === "M3"), state);
check(
  "k) M3 room/unit entries include floor/wing/type/beds/care/status",
  m3Score.completenessPct === 100
    && state.mvpData.M3.rooms[0].roomNumber === "101"
    && state.mvpData.M3.rooms[0].careDesignation === "Assisted Living",
  `M3 completeness=${m3Score.completenessPct}%`
);

state = fillM4(state);
const m4Score = scoring.scoreModule(state.modules.find((module) => module.moduleCode === "M4"), state);
check(
  "l) M4 employee entries include identity/contact/role/facility/credential/login status",
  m4Score.completenessPct === 100
    && state.mvpData.M4.employees[0].loginStatus === "active"
    && state.mvpData.M4.employees[0].credentialSummary.includes("expires"),
  `M4 completeness=${m4Score.completenessPct}%`
);


for (const moduleCode of ["M6", "M7", "M10", "M11", "M15"]) {
  const firstCollection = onboardingIntakeCatalog[moduleCode].collections[0];
  check(`${moduleCode}) resident-dependent module uses linked resident selection`, firstCollection.requiredFields.includes("residentId") && firstCollection.fields.some((field) => field.key === "residentId" && field.relation === "resident"));
}

state = fillOperationalIntakeModules(state);
const brokenLinkState = structuredClone(state);
brokenLinkState.mvpData.M6.rateRecords[0].residentId = "missing-resident-id";
const brokenM6Score = scoring.scoreModule(brokenLinkState.modules.find((module) => module.moduleCode === "M6"), brokenLinkState);
check("m0) invalid resident links do not count as complete", brokenM6Score.completenessPct < 100, `M6 broken-link completeness=${brokenM6Score.completenessPct}%`);
const vendorRecordId = state.mvpData.M18.vendorContacts[0].id;
state = stateApi.updateModuleRecord(state, "M18", "vendorContacts", vendorRecordId, { category: "Life safety updated" });
check("m1) generic intake records can be edited", state.mvpData.M18.vendorContacts[0].category === "Life safety updated");
state = stateApi.deleteModuleRecord(state, "M18", "vendorContacts", vendorRecordId);
check("m2) generic intake records can be deleted", state.mvpData.M18.vendorContacts.length === 0);
state = stateApi.addModuleRecord(state, "M18", "vendorContacts", onboardingIntakeCatalog.M18.collections[0].sampleRecord);
for (const moduleCode of Object.keys(onboardingIntakeCatalog)) {
  const moduleScore = scoring.scoreModule(state.modules.find((module) => module.moduleCode === moduleCode), state);
  check(
    `${moduleCode}) complete operational onboarding intake is captured`,
    moduleScore.completenessPct === 100,
    `${state.modules.find((module) => module.moduleCode === moduleCode)?.moduleName} completeness=${moduleScore.completenessPct}%`
  );
}

state = stateApi.updateDocument(state, "doc-gl-1", { custodianApprovalStatus: "approved", confidence: "high", notes: "Custodian selected as GL source-of-truth." });
state = stateApi.updateDocument(state, "doc-prop-1", { custodianApprovalStatus: "approved", confidence: "high", notes: "Custodian selected as property policy source-of-truth." });
const m17Score = scoring.scoreModule(state.modules.find((module) => module.moduleCode === "M17"), state);
check("m) M17 metadata/review supports title/type/facility/entity/term/version/source/currency/approval/confidence", m17Score.completenessPct === 100, `M17 completeness=${m17Score.completenessPct}%`);

state = stateApi.routeStaleDocument(state, "doc-gl-1", "Document Custodian");
state = stateApi.routeStaleDocument(state, "doc-gl-2", "Document Custodian");
state = approveScopedException(state, {
  scopeType: "document",
  scopeId: "doc-prop-1",
  ownerName: "Document Custodian",
  description: "Property policy refresh pending carrier packet; exception approved for Gate 2 intake readiness.",
  severity: "major",
  approverName: "Cameron CFO",
  approverRole: "CFO"
});
state = approveScopedException(state, {
  scopeType: "document",
  scopeId: "doc-prop-2",
  ownerName: "Document Custodian",
  description: "Superseded property policy copy retained with approved exception during intake reconciliation.",
  severity: "major",
  approverName: "Cameron CFO",
  approverRole: "CFO"
});
gate2 = gates.evaluateGate2(state);
check(
  "n) stale docs can be owner-routed or exception-approved with approver name/role",
  gateCriterion(gate2, "Stale documents are owner-routed or exception-approved")?.pass === true
    && state.exceptions.some((exception) => exception.approverName === "Cameron CFO" && exception.approverRole === "CFO")
);

state = stateApi.updateContradiction(state, "ctr-rounds-cadence-1", {
  ownerName: "DON",
  decisionOwner: "COO",
  policyValue: "Night checks every 2 hours per policy binder.",
  realityValue: "Memory-care wing performs hourly comfort rounds overnight.",
  appSettingValue: "App configured for q4h overnight reminders.",
  resolutionNotes: "COO to decide canonical launch cadence and update app template before Gate 4."
});
gate2 = gates.evaluateGate2(state);
check(
  "o) structured Policy vs Reality vs App Setting contradiction ownership/resolution is captured",
  gateCriterion(gate2, "Open contradictions have named owners")?.pass === true
    && state.contradictions[0].policyValue.includes("2 hours")
    && state.contradictions[0].decisionOwner === "COO"
);

const readinessMetrics = scoring.scoreFacility(state).moduleMetrics;
const m17Metrics = readinessMetrics.find((module) => module.moduleCode === "M17");
check(
  "p) Readiness Map metrics include owner/scope/status/score/evidence/stale/contradiction/exception/next action",
  Boolean(m17Metrics.ownerName && m17Metrics.scopeStatus && m17Metrics.status && typeof m17Metrics.score === "number" && m17Metrics.evidenceCount >= 7 && m17Metrics.staleCount >= 4 && m17Metrics.exceptionCount >= 0 && m17Metrics.nextAction)
);

gate2 = gates.evaluateGate2(state);
check("r) Gate 2 passes after complete onboarding remediation", gate2.pass === true, `facilityScore=${gate2.facilityReadinessScore}`);
state = stateApi.signGate(state, "G0", "CEO Sponsor", "Executive Sponsor", gates.evaluateGate0(state));
state = stateApi.signGate(state, "G2", "CEO Sponsor", "Executive Sponsor / COO", gate2);
const signedGate2 = state.gates.find((gate) => gate.code === "G2");
check(
  "s) Gate signing stores required signer role, signer name, timestamp, criteria snapshot, and exceptions relied upon",
  signedGate2?.status === "signed"
    && signedGate2.signedBy === "CEO Sponsor"
    && signedGate2.signedRole === "Executive Sponsor / COO"
    && signedGate2.criteriaSnapshot?.pass === true
    && signedGate2.criteriaSnapshot?.exceptionsReliedUpon?.length >= 3
);

const markdown = exportsApi.buildReadinessMarkdown(state);
const json = exportsApi.buildStateJsonExport(state);
const parsed = JSON.parse(json);
check(
  "t) executive export includes launch narrative, signed gates, criteria, complete intake, exceptions, contradictions, source-of-truth decisions, and decision log excerpts",
  markdown.includes("Launch Narrative / Executive Summary")
    && markdown.includes("Signed Gate Records")
    && markdown.includes("Exceptions Relied Upon")
    && markdown.includes("Policy=")
    && markdown.includes("Source-of-Truth Decisions")
    && markdown.includes("Complete Onboarding Intake Coverage")
    && markdown.includes("Resident roster")
    && markdown.includes("Rounds/check schedules")
    && markdown.includes("Dashboard/KPI definitions")
    && markdown.includes("Recent Decision Log Excerpts")
    && parsed.readiness.gate2.pass === true
    && parsed.completeOnboardingIntake.some((module) => module.code === "M5" && module.collections[0].recordCount === 1)
    && parsed.completeOnboardingIntake.some((module) => module.code === "M19" && module.collections[0].recordCount === 1)
    && parsed.signedGates.some((gate) => gate.code === "G2"),
  `markdownBytes=${markdown.length}, jsonBytes=${json.length}`
);

console.log("\nFacility Launch Center verification complete.");
