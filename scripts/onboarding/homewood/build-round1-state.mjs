import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { emptyOnboardingState } from '../../../facility-launch-center/src/seedData.js';
import { scoreFacility } from '../../../facility-launch-center/src/scoring.js';
import { listNormalizedArtifacts, readManifest, root, writeJson } from './ingestion-lib.mjs';

const outPath = resolve(root, 'facility-launch-center/data/homewood-round1-state.json');
const publicOutPath = resolve(root, 'public/facility-launch-static/data/homewood-round1-state.json');
const summaryPath = resolve(root, '.omx/artifacts/homewood-ingestion/HOMEWOOD-ROUND-1-STATE-SUMMARY.md');
const durableSummaryPath = resolve(root, 'docs/specs/HOMEWOOD-ROUND-1-STATE-SUMMARY-2026-05-13.md');

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function dollars(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(value);
}

function artifactById(artifacts, sourceId) {
  return artifacts.find((artifact) => artifact.sourceId === sourceId) || null;
}

function moduleByCode(state, moduleCode) {
  return state.modules.find((module) => module.moduleCode === moduleCode);
}

function markModuleFromSources(state, moduleCode, { ownerName = '', ownerTitle = '', source = '', status = 'imported_partial', nextAction = '' } = {}) {
  const module = moduleByCode(state, moduleCode);
  if (!module) return;
  if (ownerName) module.ownerName = ownerName;
  if (ownerTitle) module.ownerTitle = ownerTitle;
  if (source) module.source = source;
  module.status = status;
  module.evidenceCount = Number(module.evidenceCount || 0) + 1;
  module.nextAction = nextAction || 'Review imported Round 1 source data and resolve recorded gaps.';
}

function addReview(state, artifact, record, reason = '') {
  state.ingestionReviewQueue.push({
    id: `review-${artifact.sourceId}-${slug(record.sourceRowRef)}`,
    sourceId: artifact.sourceId,
    moduleCodes: record.moduleCodes || artifact.summary.moduleCodes || [],
    targetEntity: record.targetEntity,
    sourceRowRef: record.sourceRowRef,
    reason: reason || (record.issues || []).join('; ') || 'Needs human review before import.'
  });
}

function addGap(state, artifact, gap) {
  state.ingestionGaps.push({
    id: `gap-${artifact.sourceId}-${slug(`${gap.moduleCode}-${gap.fieldOrRecord}`)}`,
    sourceId: artifact.sourceId,
    moduleCode: gap.moduleCode,
    round: gap.round,
    fieldOrRecord: gap.fieldOrRecord,
    reason: gap.reason
  });
}

function setDecisionLog(state, manifest, artifacts) {
  state.decisionLog = [
    {
      id: `dec-homewood-round1-import-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'system',
      actionType: 'round1_real_onboarding_state_built',
      summary: `Built Homewood Round 1 real onboarding state from ${artifacts.length}/${manifest.sources.length} normalized source artifacts; no demo fixture data used.`,
      relatedType: 'facility',
      relatedId: manifest.facilityId,
      snapshot: {
        sourceArtifactCount: artifacts.length,
        readyRecords: artifacts.reduce((sum, artifact) => sum + artifact.summary.readyCount, 0),
        needsReviewRecords: artifacts.reduce((sum, artifact) => sum + artifact.summary.needsReviewCount, 0),
        gapCount: artifacts.reduce((sum, artifact) => sum + artifact.summary.gapCount, 0)
      }
    }
  ];
}

function hydrateFacilityMaster(state, artifact) {
  if (!artifact) return;
  const homewoodEntity = artifact.records.find((record) => record.targetEntity === 'legal_entities' && record.data.associatedFacilityId === 'fac-homewood');
  const homewoodProfile = artifact.records.find((record) => record.targetEntity === 'facility_profile' && record.data.id === 'fac-homewood');

  if (homewoodEntity?.data) {
    state.mvpData.M1.parentLegalName = homewoodEntity.data.legalName || '';
    state.mvpData.M1.operatingLlc = homewoodEntity.data.legalName || '';
    state.mvpData.M1.legalEntities = [{
      id: homewoodEntity.data.id,
      name: homewoodEntity.data.legalName,
      role: 'operating',
      associatedFacilityId: 'fac-homewood'
    }];
  }

  if (homewoodProfile?.data) {
    const profile = homewoodProfile.data;
    state.facility.name = profile.dba || 'Homewood Lodge ALF';
    state.facility.status = 'onboarding_round_1_imported';
    state.facility.linkedEntityIds = state.mvpData.M1.legalEntities.map((entity) => entity.id);
    state.mvpData.M1.dba = profile.dba || '';
    state.mvpData.M1.mailingAddress = [profile.addressLine1, profile.city, profile.state, profile.postalCode].filter(Boolean).join(', ');
    state.mvpData.M1.corporateContact = profile.administratorName || profile.managerName || '';
    state.mvpData.M1.billingContact = profile.managerName || '';
    state.mvpData.M2.legalName = profile.legalName || '';
    state.mvpData.M2.dba = profile.dba || 'Homewood Lodge ALF';
    state.mvpData.M2.facilityType = 'Assisted Living Facility';
    state.mvpData.M2.licenseState = profile.state || 'Florida';
    state.mvpData.M2.licenseAgency = 'AHCA';
    state.mvpData.M2.facilityAddress = [profile.addressLine1, profile.city, profile.state, profile.postalCode].filter(Boolean).join(', ');
    state.mvpData.M2.mailingAddress = state.mvpData.M2.facilityAddress;
    state.mvpData.M2.mainPhone = '';
    state.mvpData.M2.capacity = profile.bedCapacity ? String(profile.bedCapacity) : '';
    state.mvpData.M2.floorsWings = 'Single floor; no wings — from Homewood room model';
    state.mvpData.M2.executiveDirector = profile.administratorName || '';
    state.mvpData.M2.businessOfficeManager = profile.managerName || '';
    state.mvpData.M2.emergencyContact = profile.administratorName || profile.managerName || '';
    state.mvpData.M2.operatingAddressConfirmed = false;
    if (homewoodProfile.validationStatus === 'needs_review') addReview(state, artifact, homewoodProfile, 'Homewood facility profile imported for Round 1, but administrator/manager/address values require human confirmation.');
  }

  markModuleFromSources(state, 'M1', {
    ownerName: 'CEO / CFO',
    ownerTitle: 'Executive / Finance',
    source: 'Facilities Information normalized artifact',
    status: 'imported_partial',
    nextAction: 'Confirm property LLC and corporate/billing contacts, then mark owner review complete.'
  });
  markModuleFromSources(state, 'M2', {
    ownerName: 'Executive Director',
    ownerTitle: 'Facility Leader',
    source: 'Facilities Information normalized artifact',
    status: 'needs_review',
    nextAction: 'Confirm operating address, license number/expiration, after-hours phone, DON, and maintenance director.'
  });
}

function hydrateRooms(state, artifact) {
  if (!artifact) return;
  const readyRooms = artifact.records.filter((record) => record.validationStatus === 'ready' && record.targetEntity === 'rooms');
  state.mvpData.M3.rooms = readyRooms.map((record, index) => ({
    id: `room-homewood-${record.data.roomNumber || index + 1}`,
    roomNumber: String(record.data.roomNumber || index + 1),
    floor: record.data.floor || '1',
    wing: record.data.wing || 'None — single floor',
    unitType: record.data.unitType || '',
    bedCount: record.data.bedCount || 0,
    careDesignation: record.data.careDesignation || '',
    status: record.data.status || 'active',
    name: String(record.data.roomNumber || index + 1)
  }));
  state.mvpData.M3.bedsTotal = artifact.summary.bedCount || readyRooms.reduce((sum, record) => sum + Number(record.data.bedCount || 0), 0);
  state.mvpData.M3.unitsTotal = artifact.summary.roomCount || readyRooms.length;
  markModuleFromSources(state, 'M3', {
    ownerName: 'Maintenance Director',
    ownerTitle: 'Physical Plant',
    source: 'Homewood room/bed model normalized artifact',
    status: 'imported_ready',
    nextAction: 'Validate rooms against current resident assignments when face sheets/A/R arrive.'
  });
}

function hydrateInsurance(state, artifact) {
  if (!artifact) return;
  const entityByArtifact = {
    property_policy: 'Homewood Property Company LLC',
    gl_cert: state.mvpData.M1.operatingLlc || 'Sorensen, Smith & Bay LLC',
    bond_certificate: state.mvpData.M1.operatingLlc || 'Sorensen, Smith & Bay LLC',
    loss_run: state.mvpData.M1.operatingLlc || 'Sorensen, Smith & Bay LLC'
  };
  const readyDocs = artifact.records.filter((record) => record.validationStatus === 'ready' && record.data.sourceOfTruth);
  state.documents = readyDocs.map((record) => ({
    id: `doc-${slug(record.data.artifactType)}`,
    title: record.data.title,
    originalFilename: record.data.title,
    artifactType: record.data.artifactType,
    documentGroupId: `grp-${slug(record.data.artifactType)}`,
    isSourceOfTruth: true,
    currencyStatus: 'needs_review',
    facilityName: 'Homewood Lodge ALF',
    entityAssociation: entityByArtifact[record.data.artifactType] || state.mvpData.M1.operatingLlc || '',
    effectiveDate: '',
    expirationDate: '',
    term: 'Current file present in Drive; term metadata pending document custodian review.',
    version: 'round1-source-file',
    custodianApprovalStatus: 'pending_review',
    confidence: 'source_present',
    notes: 'Imported from resolved Homewood insurance source-of-truth artifact.'
  }));
  state.documentGroups = state.documents.map((doc) => ({
    id: doc.documentGroupId,
    name: doc.title.replace(/\.pdf$/i, ''),
    artifactType: doc.artifactType,
    documentIds: [doc.id],
    sourceOfTruthDocumentId: doc.id
  }));
  state.mvpData.M17.reviewNotes = 'Round 1 imported resolved Homewood GL/property/bond/loss-run source files. Document term/expiration metadata remains pending custodian review.';
  markModuleFromSources(state, 'M17', {
    ownerName: 'Document Custodian',
    ownerTitle: 'Compliance Documents',
    source: 'Homewood GL/property/bond/loss-run normalized artifact',
    status: 'needs_review',
    nextAction: 'Custodian should confirm term/effective/expiration metadata; duplicate uploads are ignored.'
  });
}

function hydrateBilling(state, arArtifact, medicaidArtifact) {
  state.mvpData.M6.billingSystemSource = 'Historical Homewood A/R workbook summaries parsed from local 2025 A/R folder; current 2026 A/R still pending.';
  state.mvpData.M6.billingCycle = 'Monthly; resident-level contract/rate records pending current A/R and face sheets.';
  state.mvpData.M6.rateApprovalOwner = 'CFO / Business Office';
  state.mvpData.M6.medicaidProviderRule = 'Provider names summarized from A/R aggregates; resident-level Medicaid/provider details pending current source files.';
  state.mvpData.M6.rateRecords = [];
  if (arArtifact) for (const gap of arArtifact.gaps || []) addGap(state, arArtifact, gap);
  if (medicaidArtifact) for (const gap of medicaidArtifact.gaps || []) addGap(state, medicaidArtifact, gap);
  markModuleFromSources(state, 'M6', {
    ownerName: 'CFO / Business Office',
    ownerTitle: 'Billing / Finance',
    source: 'Historical Homewood A/R summaries + Medicaid log gap artifact',
    status: 'imported_partial',
    nextAction: 'Import current 2026 A/R, Medicaid log, and resident-linked rate records in Round 2.'
  });
}

function hydrateAdmissions(state, artifact, referralsArtifact) {
  state.mvpData.M14.crmSource = 'Admin Log and LMH Admin Manager new-admit checklist references imported; active referral log pending.';
  state.mvpData.M14.moveInChecklistOwner = 'Sales / Admissions Director + Business Office';
  state.mvpData.M14.admissionApprovalRule = 'Use imported checklist definitions; active prospect approval workflow pending Homewood referral log.';
  state.mvpData.M14.admissionsPipeline = [];
  if (artifact) {
    for (const record of artifact.records || []) {
      if (record.validationStatus === 'needs_review') addReview(state, artifact, record);
    }
  }
  if (referralsArtifact) {
    for (const record of referralsArtifact.records || []) addReview(state, referralsArtifact, record, 'Tour/referral source exists but requires OCR/manual extraction before field-level import.');
    for (const gap of referralsArtifact.gaps || []) addGap(state, referralsArtifact, gap);
  }
  markModuleFromSources(state, 'M14', {
    ownerName: 'Sales / Admissions Director',
    ownerTitle: 'Admissions',
    source: 'Admin/LMH new-admit checklist references + tour form artifacts',
    status: 'imported_partial',
    nextAction: 'OCR tour forms and load active Homewood referral log before go-live readiness.'
  });
}

function hydrateQuickMar(state, artifact) {
  state.mvpData.M10.medicationScope = 'QuickMar remains the MAR/eMAR source. Haven imports one daily QuickMar export through n8n; Haven is not replacing QuickMar.';
  state.mvpData.M10.marSource = 'QuickMar daily export folder — export sample/header pending.';
  state.mvpData.M10.medicationOwner = 'Administrator / Assistant / DON';
  state.mvpData.M10.medicationProfiles = [];
  if (artifact) for (const gap of artifact.gaps || []) addGap(state, artifact, gap);
  markModuleFromSources(state, 'M10', {
    ownerName: 'DON',
    ownerTitle: 'Medication Process',
    source: 'QuickMar instructions + daily export workflow design artifact',
    status: 'imported_partial',
    nextAction: 'Collect one daily QuickMar export sample/header and finalize n8n parser.'
  });
}

function hydrateDietary(state, artifact) {
  state.mvpData.M11.mealSchedule = 'Breakfast/lunch/dinner logs found; exact meal times require facility confirmation.';
  state.mvpData.M11.dietarySource = 'Food service logs and dietary source summaries imported; resident-specific diet/allergy data pending face sheets.';
  state.mvpData.M11.diningOwner = 'Dining Manager / Facility staff';
  state.mvpData.M11.dietaryProfiles = [];
  markModuleFromSources(state, 'M11', {
    ownerName: 'Dining Manager',
    ownerTitle: 'Dining / Dietary',
    source: 'Food service logs normalized artifact',
    status: 'imported_partial',
    nextAction: 'Link resident-specific dietary profiles after face sheets are available.'
  });
}

function hydrateIncidents(state, artifact) {
  state.mvpData.M16.incidentPolicySource = 'Incident/grievance PDF forms and procedure templates found locally.';
  state.mvpData.M16.claimsRoutingOwner = 'ED / DON / CFO — final claims-routing owner requires confirmation.';
  state.mvpData.M16.stateReportingRule = 'Use incident reporting procedure; ED/DON review state-reporting threshold for major/critical events.';
  state.mvpData.M16.incidentWorkflows = (artifact?.records || []).filter((record) => record.validationStatus === 'ready').map((record) => ({
    id: `incident-template-${slug(record.data.file)}`,
    incidentType: record.data.file.replace(/\.pdf$/i, ''),
    severityRule: 'Needs policy review before go-live',
    immediateActions: 'Use imported incident/grievance form template; first-15-minute workflow requires owner review.',
    familyNotificationRule: 'Maybe — ED/DON decide within 24 hours',
    stateReportingThreshold: 'Maybe — ED/DON decide within 24 hours',
    claimsRouting: 'ED/DON review first, then decide',
    investigationOwner: 'DON + ED jointly',
    followUpCadence: 'Event-specific — explain in actions'
  }));
  if (artifact) for (const gap of artifact.gaps || []) addGap(state, artifact, gap);
  markModuleFromSources(state, 'M16', {
    ownerName: 'ED / DON / CFO',
    ownerTitle: 'Risk / Incidents',
    source: 'Incident/grievance forms normalized artifact',
    status: 'imported_partial',
    nextAction: 'Confirm claims-routing owner and structured incident/grievance workbook source.'
  });
}

function hydrateVendorsMaintenance(state, artifact) {
  state.mvpData.M18.vendorSource = 'Maintenance Contact List PDF plus Homewood contract PDFs.';
  state.mvpData.M18.afterHoursVendorRule = 'After-hours dispatch rules pending extraction from maintenance contact list/contracts.';
  state.mvpData.M18.vendorOwner = 'Maintenance Director / Business Office';
  const maintenanceContact = artifact?.records.find((record) => record.targetEntity === 'vendor_contact_directory_summary' && record.validationStatus === 'ready');
  state.mvpData.M18.vendorContacts = maintenanceContact ? [{
    id: 'vendor-contact-directory-summary',
    organization: 'Maintenance Contact List',
    category: 'Other',
    primaryContact: 'Directory summary — extract named contacts in Round 2',
    phone: `${maintenanceContact.data.phoneEntryCount || 0} phone entries detected`,
    afterHoursPhone: 'Pending contact-level extraction',
    accountNumber: 'N/A — directory summary',
    contractStatus: 'Unknown',
    insuranceRequired: 'Unknown',
    escalationOwner: 'Maintenance Director / Business Office'
  }] : [];
  state.mvpData.M13.workOrderSource = 'Reactive work orders plus maintenance/vendor source artifacts; 2026 inspections workbook pending.';
  state.mvpData.M13.preventiveMaintenanceCadence = 'Inspection cadence pending 2026 inspections workbook.';
  state.mvpData.M13.maintenanceOwner = 'Maintenance Director';
  state.mvpData.M13.maintenanceAssets = [];
  if (artifact) {
    for (const record of artifact.records.filter((record) => record.validationStatus === 'needs_review')) addReview(state, artifact, record);
    for (const gap of artifact.gaps || []) addGap(state, artifact, gap);
  }
  markModuleFromSources(state, 'M18', {
    ownerName: 'Maintenance / Business Office',
    ownerTitle: 'Vendors / Emergency',
    source: 'Maintenance Contact List + Homewood contract summaries',
    status: 'imported_partial',
    nextAction: 'Extract contact-level vendor details and after-hours numbers.'
  });
  markModuleFromSources(state, 'M13', {
    ownerName: 'Maintenance Director',
    ownerTitle: 'Maintenance',
    source: 'Maintenance/vendor artifact plus inspections gap record',
    status: 'imported_partial',
    nextAction: 'Locate/import 2026 inspections workbook and maintenance asset list.'
  });
}

function hydrateKpis(state, artifact) {
  state.mvpData.M19.executiveDashboardAudience = 'CEO, CFO, COO, ED, DON / launch leadership';
  state.mvpData.M19.reportCadence = 'Daily 9am huddle for first 30 days';
  state.mvpData.M19.kpiOwner = 'COO — scoreboard assembly owner pending source-field review';
  state.mvpData.M19.kpiDefinitions = [];
  if (artifact) for (const record of artifact.records || []) addReview(state, artifact, record);
  markModuleFromSources(state, 'M19', {
    ownerName: 'COO',
    ownerTitle: 'Executive Reporting',
    source: '2026 Standup Call Log normalized artifact',
    status: 'needs_review',
    nextAction: 'Define Homewood-specific KPI rows, owners, targets, and action-if-off-track.'
  });
}

function hydrateRound2Gaps(state, artifacts) {
  for (const artifact of artifacts) {
    for (const gap of artifact.gaps || []) {
      if (!state.ingestionGaps.some((existing) => existing.sourceId === artifact.sourceId && existing.fieldOrRecord === gap.fieldOrRecord)) addGap(state, artifact, gap);
    }
  }
  const gapModules = new Set(state.ingestionGaps.map((gap) => gap.moduleCode));
  for (const moduleCode of gapModules) {
    const module = moduleByCode(state, moduleCode);
    if (module && module.status === 'not_started') {
      module.status = 'gap_pending_source';
      module.nextAction = 'Round 2 source gap recorded; continue importing unrelated ready data.';
    }
  }
}

function assertNoDemoContamination(state) {
  const serialized = JSON.stringify(state);
  const forbidden = ['dec-seed-1', 'Seeded Homewood pilot fixture initialized', 'HOMEWOOD GL CERT 2.pdf', 'HOMEWOOD PROPERTY POLICY 2.pdf'];
  const found = forbidden.filter((marker) => serialized.includes(marker));
  if (found.length) throw new Error(`Round 1 state contains forbidden demo/duplicate marker(s): ${found.join(', ')}`);
}

const manifest = readManifest();
const artifacts = listNormalizedArtifacts();
const state = clone(emptyOnboardingState);
state.ingestionManifest = {
  facilityId: manifest.facilityId,
  facilityName: manifest.facilityName,
  builtAt: new Date().toISOString(),
  sourceCount: manifest.sources.length,
  artifactCount: artifacts.length,
  roundPolicy: manifest.roundPolicy,
  settledDecisions: manifest.settledDecisions
};
state.ingestionReviewQueue = [];
state.ingestionGaps = [];
state.facility.pilotWarnings = [];

hydrateFacilityMaster(state, artifactById(artifacts, 'src-facility-master'));
hydrateRooms(state, artifactById(artifacts, 'src-room-model'));
hydrateInsurance(state, artifactById(artifacts, 'src-insurance-docs'));
hydrateBilling(state, artifactById(artifacts, 'src-ar'), artifactById(artifacts, 'src-medicaid-log'));
hydrateAdmissions(state, artifactById(artifacts, 'src-admissions-checklists'), artifactById(artifacts, 'src-referrals-tour'));
hydrateQuickMar(state, artifactById(artifacts, 'src-quickmar-daily'));
hydrateDietary(state, artifactById(artifacts, 'src-dietary'));
hydrateIncidents(state, artifactById(artifacts, 'src-incidents-grievances'));
hydrateVendorsMaintenance(state, artifactById(artifacts, 'src-inspections-vendors'));
hydrateKpis(state, artifactById(artifacts, 'src-kpis-standup'));
hydrateRound2Gaps(state, artifacts);
setDecisionLog(state, manifest, artifacts);

state.facility.pilotWarnings = state.ingestionGaps.map((gap) => `${gap.moduleCode}: ${gap.fieldOrRecord}`);
state.gates = [
  { code: 'G0', name: 'Program Charter', status: 'not_started', blockers: ['Round 1 real import loaded; program signer fields still require confirmation.'], requiredSignerRole: 'Executive Sponsor' },
  { code: 'G2', name: 'Owner + Intake Readiness', status: 'blocked', blockers: ['Round 2 gaps remain after Round 1 import.'], requiredSignerRole: 'Executive Sponsor / COO' }
];

assertNoDemoContamination(state);
const readiness = scoreFacility(state);
writeJson(outPath, state);
writeJson(publicOutPath, state);

const lines = [
  '# Homewood Round 1 Hydrated State Summary',
  '',
  `Generated: ${state.ingestionManifest.builtAt}`,
  '',
  `- Output: \`${outPath.replace(`${root}/`, '')}\``,
  `- Normalized artifacts consumed: ${artifacts.length}/${manifest.sources.length}`,
  `- Review queue records: ${state.ingestionReviewQueue.length}`,
  `- Gap records: ${state.ingestionGaps.length}`,
  `- Documents imported: ${state.documents.length}`,
  `- Rooms imported: ${state.mvpData.M3.rooms.length}`,
  `- Facility readiness after Round 1 import: ${readiness.facilityReadinessScore}`,
  '',
  '## Remaining gaps',
  '',
  '| Module | Source ID | Field/source | Reason |',
  '| --- | --- | --- | --- |',
  ...state.ingestionGaps.map((gap) => `| ${gap.moduleCode} | ${gap.sourceId} | ${gap.fieldOrRecord} | ${gap.reason} |`),
  '',
  '## Import rule',
  '',
  'This state is generated from normalized Round 1 artifacts and the empty onboarding shell. Demo fixture state is not used.'
];
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, `${lines.join('\n')}\n`);
writeFileSync(durableSummaryPath, `${lines.join('\n')}\n`);

console.log(`Wrote ${outPath}`);
console.log(`Wrote ${publicOutPath}`);
console.log(`Wrote ${summaryPath}`);
console.log(`Wrote ${durableSummaryPath}`);
console.log(`Round 1 hydrated state: readiness=${readiness.facilityReadinessScore}, reviews=${state.ingestionReviewQueue.length}, gaps=${state.ingestionGaps.length}, docs=${state.documents.length}, rooms=${state.mvpData.M3.rooms.length}`);
