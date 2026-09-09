import type { InsuranceDocument, PolicyType } from './workspace-types';
export const SERVICING_KINDS = ['renewal_package', 'vendor_evidence', 'loss_report', 'claim_matter', 'workforce_exposure'] as const;
export type ServicingKind = typeof SERVICING_KINDS[number];
export const SERVICING_STATUSES = ['draft', 'review_required', 'approved', 'rejected', 'exception_approved', 'shared', 'acknowledged', 'closed'] as const;
export type ServicingStatus = typeof SERVICING_STATUSES[number];
export type RenewalPackagePayload = {
  period_start: string;
  period_end: string;
  document_ids: string[];
  location_changes: string;
  exposures: string;
  open_questions: string;
  recipient: string;
  /** Added by the database; never accepted from a browser save command. */
  policy_snapshot?: Record<string, unknown>;
};
export type VendorEvidencePayload = {
  vendor_id: string;
  contract_id: string | null;
  requirements: string;
  requires_endorsement: boolean;
  endorsement_document_id: string | null;
  endorsement_page: number | null;
  assessment: string;
  exception_reason: string | null;
  expiration_date: string;
};
export type LossReportClaim = {
  claim_reference: string;
  loss_date: string | null;
  paid_cents: number | null;
  reserve_cents: number | null;
  recovery_cents: number | null;
  expense_cents: number | null;
  incurred_cents: number | null;
  incurred_includes_expenses: boolean | null;
  page: number | null;
};
export type LossReportPayload = {
  carrier_name: string;
  valuation_date: string;
  period_start: string;
  period_end: string;
  coverage_line: string;
  complete_periods: boolean;
  no_losses_confirmed: boolean;
  no_loss_evidence_page: number | null;
  claims: LossReportClaim[];
};
export type ClaimMatterPayload = {
  incident_id: string | null;
  carrier_reference: string | null;
  loss_date: string;
  reported_date: string | null;
  recipient: string | null;
  acknowledgment: string | null;
  next_action: string;
  description: string;
};
export type WorkforceExposureRow = {
  state: string;
  class_code: string;
  estimated_payroll_cents: number | null;
  actual_payroll_cents: number | null;
  basis_note: string;
};
export type WorkforceExposurePayload = {
  period_start: string;
  period_end: string;
  broker_mapping_confirmed: boolean;
  rows: WorkforceExposureRow[];
  notes: string;
  manual_source_reason: string | null;
};
export type ServicingPayloadMap = {
  renewal_package: RenewalPackagePayload;
  vendor_evidence: VendorEvidencePayload;
  loss_report: LossReportPayload;
  claim_matter: ClaimMatterPayload;
  workforce_exposure: WorkforceExposurePayload;
};
export type ServicingPayload = ServicingPayloadMap[ServicingKind];
export type ServicingEvent = {
  action: string;
  note?: string | null;
  recipient?: string | null;
  acknowledgment?: string | null;
  reported_date?: string | null;
  actor?: string;
  timestamp?: string;
};
export type ServicingVersion = {
  id: string;
  record_id: string;
  version: number;
  snapshot: ServicingRecord;
  event: ServicingEvent;
  actor_id?: string;
  created_at: string;
};
type ServicingRecordBase = {
  id: string;
  organization_id: string;
  entity_id: string;
  facility_id: string | null;
  policy_id: string | null;
  document_id: string | null;
  title: string;
  status: ServicingStatus;
  version: number;
  owner_id: string | null;
  due_date: string | null;
  source_record_id: string | null;
  superseded_by: string | null;
  event_metadata: ServicingEvent | Record<string, never>;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  display_names?: {
    entity?: string | null;
    facility?: string | null;
    vendor?: string | null;
    contract?: string | null;
    owner?: string | null;
    incident?: string | null;
  };
  versions?: ServicingVersion[];
};
export type ServicingRecord<K extends ServicingKind = ServicingKind> = { [P in K]: ServicingRecordBase & {
  kind: P;
  payload: ServicingPayloadMap[P];
} }[K];
export type LossMetricTotal = {
  known_subtotal_cents: number;
  missing_count: number;
  total_cents: number | null;
};
export type LossTotals = {
  paid_cents: LossMetricTotal;
  reserve_cents: LossMetricTotal;
  recovery_cents: LossMetricTotal;
  expense_cents: LossMetricTotal;
  incurred_cents: LossMetricTotal;
  claim_count: number;
  history_complete: boolean;
};
export type ServicingWorkspace = {
  records: ServicingRecord[];
  entities: {
    id: string;
    name: string;
  }[];
  facilities: {
    id: string;
    name: string;
    entity_id: string;
  }[];
  policies: {
    id: string;
    entity_id: string;
    policy_number: string;
    carrier_name: string;
    policy_type: PolicyType;
    verification_status: 'unverified' | 'verified';
    version: number;
    insured_entity_ids?: string[];
    covered_facility_ids?: string[];
  }[];
  incidents?: {
    id: string;
    facility_id: string;
    incident_type: string;
    occurred_at: string;
  }[];
  documents: InsuranceDocument[];
  vendors: {
    id: string;
    name: string;
  }[];
  contracts: {
    id: string;
    vendor_id: string;
    title: string;
  }[];
  owners: {
    id: string;
    name: string;
  }[];
  loss_totals: LossTotals;
  versions?: ServicingVersion[];
};
export type ServicingExport = {
  record: ServicingRecord<'renewal_package'>;
  version: number;
};
export const SERVICING_KIND_LABELS: Record<ServicingKind, string> = {
  renewal_package: 'Renewal package',
  vendor_evidence: 'Vendor evidence',
  loss_report: 'Carrier loss report',
  claim_matter: 'Insurance matter',
  workforce_exposure: 'Workforce exposure'
};
export function createEmptyServicingPayload<K extends ServicingKind>(kind: K): ServicingPayloadMap[K] {
  const defaults: ServicingPayloadMap = {
    renewal_package: {
      period_start: '',
      period_end: '',
      document_ids: [],
      location_changes: '',
      exposures: '',
      open_questions: '',
      recipient: ''
    },
    vendor_evidence: {
      vendor_id: '',
      contract_id: null,
      requirements: '',
      requires_endorsement: false,
      endorsement_document_id: null,
      endorsement_page: null,
      assessment: '',
      exception_reason: null,
      expiration_date: ''
    },
    loss_report: {
      carrier_name: '',
      valuation_date: '',
      period_start: '',
      period_end: '',
      coverage_line: '',
      complete_periods: false,
      no_losses_confirmed: false,
      no_loss_evidence_page: null,
      claims: []
    },
    claim_matter: {
      incident_id: null,
      carrier_reference: null,
      loss_date: '',
      reported_date: null,
      recipient: null,
      acknowledgment: null,
      next_action: '',
      description: ''
    },
    workforce_exposure: {
      period_start: '',
      period_end: '',
      broker_mapping_confirmed: false,
      rows: [],
      notes: '',
      manual_source_reason: null
    }
  };
  return defaults[kind];
}
