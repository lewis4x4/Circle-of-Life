import { seedState, STORAGE_KEY } from "./seedData.js";

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

export function loadState() {
  const raw = readStorage();
  if (!raw) return resetState();
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Facility Launch Center storage parse failed; resetting demo state.", error);
    return resetState();
  }
}

export function saveState(state) {
  return withSaved(state);
}

export function resetState() {
  const seeded = clone(seedState);
  return withSaved(seeded);
}

export function appendDecisionLog(state, entry) {
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

export function updateProgramField(state, field, value) {
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

export function updateProgramThreshold(state, field, value) {
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

export function updateOwnerWorksheetRow(state, moduleCode, patch) {
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

export function updateMvpDataField(state, moduleCode, field, value) {
  const next = clone(state);
  next.mvpData = next.mvpData || {};
  next.mvpData[moduleCode] = next.mvpData[moduleCode] || {};
  next.mvpData[moduleCode][field] = normalizeMvpFieldValue(moduleCode, field, value);
  return withSaved(next);
}

export function addM3Room(state, roomInput) {
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

export function addM4Employee(state, employeeInput, roleInput = "") {
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


export function addModuleRecord(state, moduleCode, collectionKey, payload) {
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

export function addDocument(state, payload) {
  const title = String(payload.title || payload.fileName || payload.originalFilename || "").trim();
  if (!title) return state;
  const next = clone(state);
  next.documents = next.documents || [];
  next.documentGroups = next.documentGroups || [];
  const id = payload.id || `doc-${Date.now()}-${next.documents.length}`;
  const groupId = payload.documentGroupId || `grp-${id}`;
  const doc = {
    id,
    title,
    originalFilename: payload.originalFilename || payload.fileName || title,
    artifactType: payload.artifactType || "other",
    documentGroupId: groupId,
    isSourceOfTruth: Boolean(payload.isSourceOfTruth),
    currencyStatus: payload.currencyStatus || "unknown",
    facilityId: payload.facilityId || "fac-homewood",
    facilityName: payload.facilityName || "Homewood Lodge ALF",
    entityAssociation: payload.entityAssociation || "",
    effectiveDate: payload.effectiveDate || "",
    expirationDate: payload.expirationDate || "",
    term: payload.term || "",
    version: payload.version || "v1",
    custodianApprovalStatus: payload.custodianApprovalStatus || "pending",
    confidence: payload.confidence || "manual",
    notes: payload.notes || "",
    uploadedAt: new Date().toISOString()
  };
  next.documents.unshift(doc);

  let group = next.documentGroups.find((candidate) => candidate.id === groupId);
  if (!group) {
    group = {
      id: groupId,
      name: payload.groupName || `${title} group`,
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

export function updateDocument(state, documentId, patch) {
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

export function selectSourceOfTruthDocument(state, groupId, documentId) {
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

export function routeStaleDocument(state, documentId, ownerName) {
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

export function addException(state, payload) {
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

export function approveException(state, exceptionId, approverName = "", approverRole = "") {
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

export function closeException(state, exceptionId) {
  const next = clone(state);
  const ex = (next.exceptions || []).find((e) => e.id === exceptionId);
  if (!ex) return state;
  ex.status = "closed";
  ex.closedAt = new Date().toISOString();
  return withSaved(next);
}

export function addContradiction(state, payload) {
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

export function updateContradiction(state, contradictionId, patch) {
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

export function assignContradictionOwner(state, contradictionId, ownerName) {
  return updateContradiction(state, contradictionId, { ownerName: String(ownerName || "").trim() });
}

export function resolveContradiction(state, contradictionId, resolutionNotes = "", resolvedBy = "user") {
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

export function signGate(state, gateCode, signerName, signerRoleOrEvaluation, maybeEvaluation) {
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
