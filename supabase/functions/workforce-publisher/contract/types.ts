/** Roster-only v1 source assertions. These types never establish Front Office authority. */
export const WORKFORCE_DATASET = 'workforce_roster' as const;
export const WORKFORCE_VERSION = 1 as const;
export const WORKFORCE_COLLECTIONS = ['units', 'people', 'assignments', 'roles', 'reporting'] as const;
export type WorkforceCollection = typeof WORKFORCE_COLLECTIONS[number];
export type WorkforceSource = 'haven' | 'cornerstone';
export type WorkforceUnitType = 'organization' | 'entity' | 'facility';
export type WorkforcePersonType = 'staff' | 'person';
export interface WorkforceReference<T extends string = string> { record_type: T; source_record_id: string }
export type WorkforceUnitReference = WorkforceReference<WorkforceUnitType>;
export type WorkforcePersonReference = WorkforceReference<WorkforcePersonType>;
export interface WorkforceRecord {
  source_record_id: string; record_state: 'present' | 'retired' | 'deleted';
  source_updated_at: string | null; record_retired_at: string | null; record_deleted_at: string | null;
}
export interface WorkforceUnit extends WorkforceRecord {
  record_type: WorkforceUnitType; display_name: string;
  unit_kind: 'business_group' | 'legal_entity' | 'facility' | 'unknown'; source_kind: string | null;
  source_status: 'active' | 'inactive' | 'suspended' | 'under_renovation' | 'archived' | 'dissolved' | 'merged' | 'closed' | 'unknown' | null;
  parent_ref: WorkforceUnitReference | null;
  parent_relation: 'source_scope' | 'source_entity_parent' | 'source_facility_entity' | null;
}
export interface WorkforcePerson extends WorkforceRecord {
  record_type: WorkforcePersonType; display_name: string;
  person_kind: 'staff' | 'employee' | 'officer' | 'sub_worker' | 'contact' | 'buyer' | 'unknown';
  staff_role: string | null; job_title: string | null;
  employment_status: 'active' | 'on_leave' | 'terminated' | 'suspended' | 'unknown';
  employer_ref: WorkforceUnitReference | null;
  source_hire_date: string | null; source_termination_date: string | null;
  last_day_worked: string | null; effective_employment_end: string | null; source_processed_at: string | null;
  pay_basis: 'salary' | 'hourly' | 'other' | 'unknown' | null;
  pay_basis_effective_from: string | null; pay_basis_evidence: 'explicit_source' | null;
}
export interface WorkforceAssignment extends WorkforceRecord {
  record_type: 'staff_home' | 'staff_facility_assignment';
  person_ref: WorkforcePersonReference; unit_ref: WorkforceUnitReference;
  assignment_kind: 'home' | 'additional'; role_code: string | null; source_is_primary: boolean | null;
  source_start_date: string | null; source_end_date: string | null;
  source_end_inclusive: boolean | null;
}
export interface WorkforceRole extends WorkforceRecord {
  record_type: 'facility_executive' | 'entity_officer'; unit_ref: WorkforceUnitReference;
  role_code: 'facility_executive' | 'entity_officer'; title: string | null;
  holder_ref: WorkforceReference<WorkforcePersonType | 'user'> | null;
  holder_resolution: 'resolved' | 'unresolved' | 'vacant';
  source_start_date: string | null; source_end_date: string | null;
  date_kind: 'effective' | 'signing'; source_end_inclusive: boolean | null;
}
export interface WorkforceReporting extends WorkforceRecord {
  record_type: 'explicit_reporting'; person_ref: WorkforcePersonReference; manager_ref: WorkforcePersonReference;
  unit_ref: WorkforceUnitReference | null; kind: 'primary' | 'functional' | 'acting';
  source_start_date: string | null; source_end_date: string | null; source_end_inclusive: boolean | null;
}
export interface WorkforceRecords {
  units: WorkforceUnit[]; people: WorkforcePerson[]; assignments: WorkforceAssignment[];
  roles: WorkforceRole[]; reporting: WorkforceReporting[];
}
export type WorkforceCounts = Record<WorkforceCollection, number>;
export interface WorkforceSnapshot {
  source_system: WorkforceSource; source_tenant_id: string; dataset: typeof WORKFORCE_DATASET;
  contract_version: typeof WORKFORCE_VERSION; batch_id: string; sequence: number; source_as_of: string;
  mode: 'full'; complete: true; counts: WorkforceCounts; payload_sha256: string; records: WorkforceRecords;
}
/** Loaded privately at the receiving boundary; no caller-controlled registration. */
export interface WorkforceSourceContract {
  key_id: string; source_system: WorkforceSource; source_tenant_id: string; dataset: typeof WORKFORCE_DATASET;
  enabled: boolean;
}
export interface ValidatedWorkforceSnapshot {
  snapshot: WorkforceSnapshot; body_sha256: string; payload_sha256: string;
  /** Receiver wall clock, never a field admitted from the publisher. */
  received_at: string;
}
