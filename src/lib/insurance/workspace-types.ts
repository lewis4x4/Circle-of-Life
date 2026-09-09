/** Shared browser/server contract. Drafts are never active policy records. */
export const POLICY_TYPES = [
  "general_liability",
  "property",
  "workers_comp",
  "auto",
  "umbrella",
  "directors_officers",
  "cyber",
  "epli",
  "professional",
  "other",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
export type PolicyEvidence = Record<
  string,
  {
    source: "document" | "manual";
    document_id?: string;
    page?: number;
    excerpt?: string;
    reason?: string;
  }
>;
export type PolicyDraft = {
  entity_id: string;
  policy_type: PolicyType;
  carrier_name: string;
  broker_name: string | null;
  policy_number: string;
  effective_date: string;
  expiration_date: string;
  premium_cents: number | null;
  aggregate_limit_cents: number | null;
  occurrence_limit_cents: number | null;
  deductible_cents: number | null;
  premium_period: string | null;
  notes: string | null;
  shared_limit: boolean | null;
  parties: {
    entity_id: string;
    role: string;
    effective_from: string;
    effective_to: string | null;
  }[];
  facilities: {
    facility_id: string;
    role: string;
    effective_from: string;
    effective_to: string | null;
  }[];
  coverages?: {
    coverage_type: PolicyType;
    occurrence_limit_cents: number | null;
    aggregate_limit_cents: number | null;
    deductible_cents: number | null;
    shared_limit_group: string | null;
  }[];
  change_effective_date?: string;
};
export type InsuranceDocument = {
  id: string;
  organization_id: string;
  filename: string;
  family: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  facility_id: string | null;
  status: "uploading" | "ready" | "quarantined" | "failed";
  scan_status: "not_configured" | "clean" | "quarantined" | "failed";
  extraction_status:
    "pending" | "processing" | "review_required" | "failed" | "manual_review";
  error: string | null;
  run_id: string | null;
  lease_expires_at?: string | null;
  created_at: string;
};
export type ExtractionMetadata = {
  schema_version: 1;
  extractor_version: "haven-insurance-v1";
  provider: "openai" | "restricted_adapter" | "manual";
  configured_model: string | null;
};
export type InsuranceDraft = {
  id: string;
  document_id: string | null;
  kind: "new_policy" | "endorsement" | "renewal" | "verification";
  policy_id: string | null;
  expected_version: number | null;
  revision: number;
  status: "draft" | "approved" | "rejected";
  payload: PolicyDraft;
  evidence: PolicyEvidence;
  extraction_metadata?: ExtractionMetadata | null;
  created_at: string;
};
export type InsurancePolicy = Partial<PolicyDraft> &
  Pick<
    PolicyDraft,
    | "policy_type"
    | "carrier_name"
    | "policy_number"
    | "effective_date"
    | "expiration_date"
  > & {
    id: string;
    verification_status: "unverified" | "verified";
    version: number;
    status: string;
    predecessor_policy_id?: string | null;
  };
export type WorkItem = {
  id: string;
  policy_id: string | null;
  facility_id: string | null;
  title: string;
  kind: string;
  due_date: string | null;
  owner_id: string | null;
  status: "open" | "completed" | "dismissed";
  version: number;
  note?: string | null;
};
export type CertificateRequest = {
  id: string;
  entity_id: string;
  facility_id: string | null;
  holder_name: string;
  holder_details: string;
  requirements: string;
  owner_id: string | null;
  due_date: string | null;
  status:
    "requested" | "acknowledged" | "needs_information" | "issued" | "cancelled";
  version: number;
  document_id?: string | null;
  note?: string | null;
};
export type InsuranceWorkspace = {
  can_manage: boolean;
  owners: {
    id: string;
    name: string;
  }[];
  entities: {
    id: string;
    name: string;
  }[];
  facilities: {
    id: string;
    name: string;
    entity_id: string;
  }[];
  policies: InsurancePolicy[];
  documents: InsuranceDocument[];
  drafts: InsuranceDraft[];
  work_items: WorkItem[];
  certificate_requests: CertificateRequest[];
  claims?: {
    id: string;
    insurance_policy_id: string | null;
    claim_number: string | null;
    date_of_loss: string | null;
    status: string;
    paid_cents: number;
    reserve_cents: number;
  }[];
  premium_allocations?: {
    id: string;
    insurance_policy_id: string;
    facility_id: string;
    allocation_method: string;
    allocated_premium_cents: number;
    period_start: string;
    period_end: string;
  }[];
  versions: {
    id: string;
    policy_id: string;
    version: number;
    draft_id: string;
    kind: InsuranceDraft["kind"];
    before_snapshot: unknown;
    snapshot: unknown;
    evidence: PolicyEvidence;
    approved_by: string;
    created_at: string;
    change_effective_date?: string | null;
  }[];
};
export const DOCUMENT_FAMILIES = [
  "policy",
  "declarations",
  "endorsement",
  "certificate",
  "renewal",
  "cancellation",
  "nonrenewal",
  "loss_run",
  "other",
] as const;
export const POLICY_FIELD_LABELS: Record<string, string> = {
  entity_id: "Primary named insured",
  policy_type: "Coverage type",
  carrier_name: "Carrier",
  broker_name: "Broker",
  policy_number: "Policy number",
  effective_date: "Effective date",
  expiration_date: "Expiration date",
  premium_cents: "Premium",
  aggregate_limit_cents: "Aggregate limit",
  occurrence_limit_cents: "Occurrence limit",
  deductible_cents: "Deductible",
  premium_period: "Premium period",
  notes: "Notes",
};
export function createEmptyPolicyDraft(): PolicyDraft {
  return {
    entity_id: "",
    policy_type: "general_liability",
    carrier_name: "",
    broker_name: null,
    policy_number: "",
    effective_date: "",
    expiration_date: "",
    premium_cents: null,
    aggregate_limit_cents: null,
    occurrence_limit_cents: null,
    deductible_cents: null,
    premium_period: null,
    notes: null,
    shared_limit: null,
    parties: [],
    facilities: [],
    coverages: [],
  };
}
