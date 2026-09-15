import { RESIDENT_DOCUMENT_TYPES } from "./ui-labels";

export type ResidentIntakePrimaryState =
  | "idle"
  | "uploading"
  | "upload_failed"
  | "ready_to_parse"
  | "parsing"
  | "parse_failed"
  | "match_required"
  | "review_empty"
  | "review_populated"
  | "quarantined"
  | "conflicting"
  | "partially_applied"
  | "complete";

export type ResidentIntakeSource = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  state: string;
  classification: string | null;
  documentType: string | null;
  confidence: number | null;
  quarantineReason: string | null;
  safetyConfirmed: boolean;
  requiresSafetyConfirmation: boolean;
  residentDocumentId: string | null;
  failureMessage: string | null;
};

export type ResidentIntakeFact = {
  id: string;
  revision: string | null;
  label: string;
  fieldCode: string;
  domain: string;
  currentValue: string;
  proposedValue: string;
  sourceLabel: string;
  sourceId: string | null;
  pageNumber: number | null;
  confidence: number | null;
  conflict: boolean;
  stale: boolean;
  requiredReviewer: string;
  state: string;
  allowedActions: string[];
  canonicalFingerprint: string | null;
};

export type ResidentIntakeCandidate = {
  id: string;
  residentId: string | null;
  name: string;
  dateOfBirth: string | null;
  facilityName: string | null;
  status: string | null;
  matchKind: string | null;
};

export type ResidentIntakeChecklistItem = {
  key: string;
  label: string;
  status: string;
  count: number;
  sourceId: string | null;
  currentDocumentId: string | null;
  canAdd: boolean;
  canReplace: boolean;
};

export type ResidentIntakePermissions = {
  canReview: boolean;
  canApplyClinical: boolean;
  canApplyPayer: boolean;
  canApplyAuthority: boolean;
  canComplete: boolean;
};

export type ResidentIntakeSnapshot = {
  id: string;
  title: string;
  state: ResidentIntakePrimaryState;
  revision: string;
  facilityId: string;
  facilityName: string | null;
  residentId: string | null;
  residentName: string | null;
  admissionCaseId: string | null;
  sources: ResidentIntakeSource[];
  facts: ResidentIntakeFact[];
  candidates: ResidentIntakeCandidate[];
  checklist: ResidentIntakeChecklistItem[];
  permissions: ResidentIntakePermissions;
  counts: {
    uploaded: number;
    residentEligible: number;
    excluded: number;
    quarantined: number;
    conflicting: number;
    awaitingReview: number;
    applied: number;
  };
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function list(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  const next = text(value).trim();
  return next || null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function firstValue(source: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

const PRIMARY_STATES = new Set<ResidentIntakePrimaryState>([
  "idle",
  "uploading",
  "upload_failed",
  "ready_to_parse",
  "parsing",
  "parse_failed",
  "match_required",
  "review_empty",
  "review_populated",
  "quarantined",
  "conflicting",
  "partially_applied",
  "complete",
]);

function normalizeState(value: unknown): ResidentIntakePrimaryState {
  const candidate = text(value).toLowerCase().replace(/-/g, "_") as ResidentIntakePrimaryState;
  return PRIMARY_STATES.has(candidate) ? candidate : "review_empty";
}

function deriveState(
  intake: UnknownRecord,
  sources: ResidentIntakeSource[],
  facts: ResidentIntakeFact[],
  counts: { uploaded: number; quarantined: number; conflicting: number; applied: number },
): ResidentIntakePrimaryState {
  const rawState = text(firstValue(intake, ["primary_state", "state", "status"])).toLowerCase();
  const parserState = text(intake.parser_state).toLowerCase();
  if (PRIMARY_STATES.has(rawState as ResidentIntakePrimaryState)) return rawState as ResidentIntakePrimaryState;
  if (rawState === "complete") return "complete";
  if (sources.some((source) => source.state === "failed") && rawState === "uploading") return "upload_failed";
  if (rawState === "uploading") return "uploading";
  if (rawState === "parsing" || parserState === "running") return "parsing";
  if (parserState === "failed" || parserState === "retryable") return "parse_failed";
  if (rawState === "ready_to_parse") return "ready_to_parse";
  if (rawState === "match_required") return "match_required";
  if (counts.conflicting > 0 || facts.some((fact) => fact.conflict || fact.stale)) return "conflicting";
  if (counts.quarantined > 0) return "quarantined";
  if (rawState === "partially_applied" || counts.applied > 0 && facts.some((fact) => fact.state !== "applied" && fact.state !== "rejected")) return "partially_applied";
  if (facts.length > 0) return "review_populated";
  if (counts.uploaded > 0) return "review_empty";
  return normalizeState(rawState || "idle");
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reviewed";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "Value available";
  }
}

function operatorLabel(value: unknown, fallback: string): string {
  const raw = text(value).trim();
  if (!raw) return fallback;
  const finalToken = raw.includes(".") ? raw.split(".").at(-1) ?? raw : raw;
  return finalToken.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedSourceClass(value: unknown): string | null {
  const sourceClass = optionalText(value);
  return sourceClass === "unclassified" ? null : sourceClass;
}

/**
 * Keeps the UI tolerant of the API envelope while the database projection
 * remains server-owned. No credential text is read or copied here.
 */
export function normalizeResidentIntakeSnapshot(payload: unknown): ResidentIntakeSnapshot {
  const envelope = record(payload);
  const root = record(envelope.snapshot ?? envelope.data ?? envelope);
  const intake = record(root.intake ?? root);
  const rawSources = list(root.sources ?? intake.sources);
  const rawFacts = list(root.facts ?? root.extracted_facts ?? intake.facts);
  const rawCandidates = list(root.candidates ?? root.matches ?? intake.candidates);
  const rawChecklist = list(root.checklist ?? root.checklist_items ?? intake.checklist);
  const rawPermissions = record(root.permissions ?? intake.permissions);
  const rawCounts = record(root.counts ?? intake.counts);

  const sources = rawSources.map((source): ResidentIntakeSource => ({
    id: text(firstValue(source, ["id", "source_id"])),
    title: text(firstValue(source, ["title", "display_name", "file_name", "filename"]), "Untitled document"),
    fileName: text(firstValue(source, ["file_name", "filename", "original_filename"]), "Document"),
    mimeType: optionalText(firstValue(source, ["verified_mime", "declared_mime", "mime_type", "mime"])),
    sizeBytes: numberOrNull(firstValue(source, ["verified_size_bytes", "declared_size_bytes", "size_bytes"])),
    state: text(firstValue(source, ["state", "status", "parse_state"]), "uploaded"),
    classification: normalizedSourceClass(firstValue(source, ["classification", "source_class", "disposition"])),
    documentType: optionalText(firstValue(source, ["document_type", "document_class"])),
    confidence: numberOrNull(firstValue(source, ["classification_confidence", "confidence"])),
    quarantineReason: optionalText(firstValue(source, ["quarantine_reason", "quarantine_reason_code", "failure_reason"])),
    safetyConfirmed: boolean(firstValue(source, ["safety_confirmed", "safe_for_external_parse"])) || Boolean(source.safe_confirmed_at) || ["safe", "overridden", "not_applicable"].includes(text(source.preflight_state)),
    requiresSafetyConfirmation: boolean(firstValue(source, ["requires_safety_confirmation", "preview_confirmation_required"])) || text(source.preflight_state) === "needs_confirmation",
    residentDocumentId: optionalText(firstValue(source, ["resident_document_id", "canonical_document_id"])),
    failureMessage: optionalText(firstValue(source, ["failure_message", "error"])),
  }));

  const facts = rawFacts.map((fact): ResidentIntakeFact => {
    const allowedActions = Array.isArray(fact.allowed_actions)
      ? fact.allowed_actions.filter((item): item is string => typeof item === "string")
      : [];
    return {
      id: text(firstValue(fact, ["id", "fact_id"])),
      revision: optionalText(firstValue(fact, ["revision", "fact_revision"])),
      label: operatorLabel(firstValue(fact, ["label", "field_label", "field_code"]), "Resident fact"),
      fieldCode: text(firstValue(fact, ["field_code", "code"])),
      domain: text(firstValue(fact, ["domain", "fact_domain"]), "resident"),
      currentValue: displayValue(firstValue(fact, ["current_display_value", "current_value"])),
      proposedValue: displayValue(firstValue(fact, ["display_value", "proposed_display_value", "proposed_value", "value"])),
      sourceLabel: text(firstValue(fact, ["source_label", "source_title", "file_name"]), sources.find((source) => source.id === optionalText(firstValue(fact, ["source_id", "intake_source_id"])))?.title ?? "Packet document"),
      sourceId: optionalText(firstValue(fact, ["source_id", "intake_source_id"])),
      pageNumber: numberOrNull(firstValue(fact, ["page_number", "source_page", "page_start"])),
      confidence: numberOrNull(fact.confidence),
      conflict: boolean(firstValue(fact, ["conflict", "has_conflict"])),
      stale: boolean(firstValue(fact, ["stale", "is_stale"])) || ["stale", "stale_target"].includes(text(fact.state)),
      requiredReviewer: text(firstValue(fact, ["required_reviewer", "reviewer_class"]), "Authorized reviewer"),
      state: text(firstValue(fact, ["state", "review_state"]), "proposed"),
      allowedActions,
      canonicalFingerprint: optionalText(firstValue(fact, ["canonical_fingerprint", "current_value_fingerprint"])),
    };
  });

  const candidates = rawCandidates.map((candidate): ResidentIntakeCandidate => {
    const resident = record(candidate.resident ?? candidate.candidate);
    const residentId = optionalText(firstValue(candidate, ["resident_id", "candidate_resident_id"])) ?? optionalText(resident.id);
    const firstName = text(firstValue(candidate, ["candidate_first_name"])) || text(firstValue(resident, ["first_name", "firstName"]));
    const lastName = text(firstValue(candidate, ["candidate_last_name"])) || text(firstValue(resident, ["last_name", "lastName"]));
    return {
      id: text(firstValue(candidate, ["id", "match_id"]), residentId ?? "candidate"),
      residentId,
      name: text(firstValue(candidate, ["resident_name", "name"]), `${firstName} ${lastName}`.trim() || "Resident candidate"),
      dateOfBirth: optionalText(firstValue(candidate, ["candidate_date_of_birth", "date_of_birth", "dob"])) ?? optionalText(resident.date_of_birth),
      facilityName: optionalText(firstValue(candidate, ["facility_name"])) ?? optionalText(record(resident.facility).name),
      status: optionalText(firstValue(candidate, ["candidate_status", "resident_status", "status"])) ?? optionalText(resident.status),
      matchKind: optionalText(firstValue(candidate, ["match_kind", "candidate_state", "candidate_kind"])),
    };
  });

  const serverChecklist = rawChecklist.map((item, index): ResidentIntakeChecklistItem => ({
    key: text(firstValue(item, ["key", "document_type", "type"]), `item-${index}`),
    label: operatorLabel(firstValue(item, ["label", "document_label", "document_type"]), "Required document"),
    status: text(firstValue(item, ["status", "state"]), "missing"),
    count: numberOrNull(item.count) ?? (text(firstValue(item, ["status", "state"])) === "missing" ? 0 : 1),
    sourceId: optionalText(firstValue(item, ["source_id", "intake_source_id"])),
    currentDocumentId: optionalText(firstValue(item, ["current_document_id", "resident_document_id"])),
    canAdd: item.can_add === undefined ? true : boolean(item.can_add),
    canReplace: boolean(item.can_replace) || Boolean(firstValue(item, ["current_document_id", "resident_document_id"])),
  }));

  const checklistAliases: Record<string, string> = {
    facesheet_demographics: "demographics_face_sheet",
    insurance_financial_cards: "insurance_card",
    medication_list: "physician_orders_medication_list",
    physician_orders: "physician_orders_medication_list",
    advance_directives: "advance_directive",
    privacy_practices_hipaa: "hipaa_privacy",
    resident_bill_of_rights: "resident_rights",
    tuberculosis_screening: "tb_screening",
    care_plan_acknowledgment: "care_plan_service_plan_acknowledgment",
    registry_screening: "resident_screening",
  };
  const serverByKey = new Map(serverChecklist.map((item) => [checklistAliases[item.key] ?? item.key, item]));
  const checklist = RESIDENT_DOCUMENT_TYPES
    .filter(([key]) => key !== "other_resident_evidence")
    .map(([key, label]): ResidentIntakeChecklistItem => {
      const server = serverByKey.get(key);
      const matching = sources.filter((source) => source.documentType === key && source.classification === "resident");
      const pending = matching.find((source) => !source.residentDocumentId) ?? null;
      const applied = matching.find((source) => source.residentDocumentId) ?? null;
      const currentDocumentId = server?.currentDocumentId ?? applied?.residentDocumentId ?? null;
      const sourceId = pending?.id ?? server?.sourceId ?? applied?.id ?? null;
      const sourceStatus = pending
        ? pending.state === "review" ? "awaiting_review" : "present"
        : applied ? "applied" : null;
      return {
        key,
        label: server?.label ?? label,
        status: sourceStatus ?? server?.status ?? "missing",
        count: Math.max(server?.count ?? 0, matching.length),
        sourceId,
        currentDocumentId,
        canAdd: Boolean(pending),
        canReplace: Boolean(pending && currentDocumentId),
      };
    });

  const uploaded = numberOrNull(firstValue(rawCounts, ["uploaded", "source_total", "sources_total", "uploaded_sources"])) ?? sources.length;
  const quarantined = numberOrNull(firstValue(rawCounts, ["quarantined", "sources_quarantined"])) ?? sources.filter((source) => source.state === "quarantined" || source.classification === "credential_secret").length;
  const conflicting = numberOrNull(firstValue(rawCounts, ["conflicting", "facts_conflicting"])) ?? facts.filter((fact) => fact.conflict || fact.stale).length;
  const applied = numberOrNull(firstValue(rawCounts, ["applied", "facts_applied"])) ?? facts.filter((fact) => fact.state === "applied").length;
  const normalizedCounts = { uploaded, quarantined, conflicting, applied };
  const can = record(root.can ?? intake.can);

  return {
    id: text(firstValue(intake, ["id", "intake_id"])),
    title: text(firstValue(intake, ["title", "name"]), "Resident packet intake"),
    state: deriveState(intake, sources, facts, normalizedCounts),
    revision: text(firstValue(intake, ["revision", "version"])),
    facilityId: text(firstValue(intake, ["facility_id", "facilityId"])),
    facilityName: optionalText(firstValue(intake, ["facility_name", "facilityName"])),
    residentId: optionalText(firstValue(intake, ["resident_id", "residentId"])),
    residentName: optionalText(firstValue(intake, ["resident_name", "residentName"])),
    admissionCaseId: optionalText(firstValue(intake, ["admission_case_id", "admissionCaseId"])),
    sources,
    facts,
    candidates,
    checklist,
    permissions: {
      canReview: boolean(firstValue(rawPermissions, ["can_review", "manage"])) || boolean(can.manage),
      canApplyClinical: boolean(firstValue(rawPermissions, ["can_apply_clinical", "apply_clinical", "clinical"])) || boolean(can.clinical),
      canApplyPayer: boolean(firstValue(rawPermissions, ["can_apply_payer", "apply_payer", "payer"])) || boolean(can.payer),
      canApplyAuthority: boolean(firstValue(rawPermissions, ["can_apply_authority", "apply_authority", "legal"])) || boolean(can.legal),
      canComplete: boolean(firstValue(rawPermissions, ["can_complete", "complete", "manage"])) || boolean(can.manage),
    },
    counts: {
      uploaded,
      residentEligible: numberOrNull(firstValue(rawCounts, ["resident_eligible", "eligible"])) ?? sources.filter((source) => source.classification === "resident").length,
      excluded: numberOrNull(rawCounts.excluded) ?? sources.filter((source) => ["facility", "employee", "other_resident", "unreadable", "unsupported", "excluded"].includes(source.classification ?? "")).length,
      quarantined,
      conflicting,
      awaitingReview: numberOrNull(firstValue(rawCounts, ["awaiting_review", "review_pending", "facts_awaiting_review"])) ?? facts.filter((fact) => ["proposed", "corrected"].includes(fact.state)).length,
      applied,
    },
  };
}

export function snapshotRevision(payload: unknown, fallback: string): string {
  const envelope = record(payload);
  const root = record(envelope.snapshot ?? envelope.data ?? envelope);
  const intake = record(root.intake ?? root);
  return text(firstValue(intake, ["revision", "version"]), fallback);
}
