import { onboardingIntakeCatalog, fullIntakeModuleCodes } from "./intakeCatalog.js";

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

export function hasApprovedException(state, scopeType, scopeId) {
  const normalizedScopeType = String(scopeType || "").trim();
  const normalizedScopeId = normalizeScopeId(scopeId);

  return safeArray(state?.exceptions).some((exception) => {
    if (exception.status !== "approved") return false;
    if (exception.scopeType !== normalizedScopeType) return false;
    if (isExpired(exception)) return false;
    return normalizeScopeId(exception.scopeId) === normalizedScopeId;
  });
}

export function hasApprovedModuleException(state, module) {
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

function requiredRecordComplete(record, requiredFields = []) {
  return requiredFields.every((field) => present(record?.[field]));
}

function getCatalogCompleteness(data, spec) {
  const checks = [];
  for (const field of spec.fields || []) checks.push(present(data?.[field.key]));
  for (const collection of spec.collections || []) {
    const rows = safeArray(data?.[collection.key]);
    checks.push(rows.length > 0);
    checks.push(rows.some((row) => requiredRecordComplete(row, collection.requiredFields || [])));
  }
  return pct(checks);
}

export function getIntakeRecordCounts(state) {
  return Object.fromEntries(Object.entries(onboardingIntakeCatalog).map(([code, spec]) => [
    code,
    Object.fromEntries((spec.collections || []).map((collection) => [collection.key, safeArray(state?.mvpData?.[code]?.[collection.key]).length]))
  ]));
}

export function moduleHasOwnerCoverage(module) {
  return Boolean(module?.ownerName && module?.source && module?.dueDate);
}

export function moduleHasOwnerCoverageOrException(module, state) {
  return moduleHasOwnerCoverage(module) || hasApprovedModuleException(state, module);
}

export function getModulesMissingCoverage(modules = [], state = null) {
  return modules.filter((m) => m.scopeStatus !== "out" && !moduleHasOwnerCoverageOrException(m, state));
}

export function getUnresolvedDuplicateGroups(state) {
  return safeArray(state?.documentGroups).filter((group) => {
    const hasDuplicates = safeArray(group.documentIds).length > 1;
    return hasDuplicates && !group.sourceOfTruthDocumentId;
  });
}

export function getInvalidSourceOfTruthGroups(state) {
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

export function getStaleDocumentsWithoutApprovedException(state) {
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
  if (intakeSpec) return getCatalogCompleteness(data, intakeSpec);

  return 0;
}

export function getModuleReadinessMetrics(module, state) {
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

export function scoreModule(module, state) {
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

export function scoreFacility(state) {
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
