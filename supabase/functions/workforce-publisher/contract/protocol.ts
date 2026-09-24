import {
  WORKFORCE_COLLECTIONS, WORKFORCE_DATASET, WORKFORCE_VERSION,
  type WorkforceCounts, type WorkforceRecords, type WorkforceSnapshot,
  type WorkforceSource, type WorkforceSourceContract, type ValidatedWorkforceSnapshot,
} from './types.ts';

export const WORKFORCE_MAX_BYTES = 2 * 1024 * 1024;
export const WORKFORCE_MAX_PEOPLE = 5_000;
export const WORKFORCE_MAX_UNITS = 500;
export const WORKFORCE_MAX_ROWS = 20_000;
export const WORKFORCE_MAX_SKEW_SECONDS = 300;
export class WorkforceProtocolError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const token = /^[a-z][a-z0-9_]{0,79}$/;
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
type ObjectValue = Record<string, unknown>;
const common = ['source_record_id', 'record_state', 'source_updated_at', 'record_retired_at', 'record_deleted_at'];
const fields = {
  units: [...common, 'record_type', 'display_name', 'unit_kind', 'source_kind', 'source_status', 'parent_ref', 'parent_relation'],
  people: [...common, 'record_type', 'display_name', 'person_kind', 'staff_role', 'job_title', 'employment_status', 'employer_ref', 'source_hire_date', 'source_termination_date', 'last_day_worked', 'effective_employment_end', 'source_processed_at', 'pay_basis', 'pay_basis_effective_from', 'pay_basis_evidence'],
  assignments: [...common, 'record_type', 'person_ref', 'unit_ref', 'assignment_kind', 'role_code', 'source_is_primary', 'source_start_date', 'source_end_date', 'source_end_inclusive'],
  roles: [...common, 'record_type', 'unit_ref', 'role_code', 'title', 'holder_ref', 'holder_resolution', 'source_start_date', 'source_end_date', 'date_kind', 'source_end_inclusive'],
  reporting: [...common, 'record_type', 'person_ref', 'manager_ref', 'unit_ref', 'kind', 'source_start_date', 'source_end_date', 'source_end_inclusive'],
};
function reject(code: string, status = 400): never { throw new WorkforceProtocolError(code, status); }
function object(value: unknown): value is ObjectValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is ObjectValue {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function oneOf(value: unknown, options: readonly unknown[]): boolean { return options.includes(value); }
function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= max && !controls.test(value) && !unpairedSurrogate.test(value);
}
function identifier(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
function nullableText(value: unknown, max = 200): boolean { return value === null || text(value, max); }
function nullableCode(value: unknown): boolean { return value === null || typeof value === 'string' && token.test(value); }
function date(value: unknown): boolean {
  return value === null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown, now: number, nullable = true): boolean {
  return nullable && value === null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && Date.parse(value) <= now + WORKFORCE_MAX_SKEW_SECONDS * 1000;
}
function reference(value: unknown, types: readonly string[], nullable = false): value is ObjectValue | null {
  return nullable && value === null || exact(value, ['record_type', 'source_record_id']) && oneOf(value.record_type, types) && identifier(value.source_record_id);
}
function key(value: unknown): string { const ref = value as ObjectValue; return `${ref.record_type}:${ref.source_record_id}`; }
function commonRecord(row: ObjectValue, now: number): boolean {
  return identifier(row.source_record_id) && oneOf(row.record_state, ['present', 'retired', 'deleted'])
    && timestamp(row.source_updated_at, now) && timestamp(row.record_retired_at, now) && timestamp(row.record_deleted_at, now)
    && (row.record_state !== 'retired' || row.record_retired_at !== null)
    && (row.record_state !== 'deleted' || row.record_deleted_at !== null)
    && (row.record_state !== 'present' || row.record_retired_at === null && row.record_deleted_at === null);
}
function sourceDates(row: ObjectValue): boolean {
  return date(row.source_start_date) && date(row.source_end_date) && oneOf(row.source_end_inclusive, [true, false, null])
    && (row.source_end_date !== null || row.source_end_inclusive === null)
    && (row.source_start_date === null || row.source_end_date === null || String(row.source_end_date) >= String(row.source_start_date));
}
/** Exact deterministic hash serialization: keys sorted by JS UTF-16 order, arrays retain order,
 * JSON.stringify scalar/string escaping, no whitespace/newline/BOM, encoded as UTF-8. */
export function canonicalWorkforceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorkforceJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalWorkforceJson(value[k])}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  return reject('invalid_contract');
}
function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
export async function workforceSha256(raw: Uint8Array): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', new Uint8Array(raw))); }
export async function workforcePayloadHash(records: WorkforceRecords): Promise<string> { return workforceSha256(encoder.encode(canonicalWorkforceJson(records))); }
export function workforceSigningBytes(contract: WorkforceSourceContract, sentAt: string, raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`front-office-workforce-v1\nPOST\napplication/json\n${contract.key_id}\n${sentAt}\n${contract.source_system}\n${contract.source_tenant_id}\n${contract.dataset}\n`);
  const result = new Uint8Array(prefix.length + raw.length); result.set(prefix); result.set(raw, prefix.length); return result;
}
export async function signWorkforceBytes(secret: string, contract: WorkforceSourceContract, sentAt: string, raw: Uint8Array): Promise<string> {
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', signingKey, workforceSigningBytes(contract, sentAt, raw)));
}
/** Counts include explicit deleted/retired source records. Absence is never a termination. */
export function workforceCounts(records: WorkforceRecords): WorkforceCounts {
  return Object.fromEntries(WORKFORCE_COLLECTIONS.map(collection => [collection, records[collection].length])) as WorkforceCounts;
}

/** Structural/source-reference checks only; never a canonical placement or employment command. */
export function validateWorkforceRecords(value: unknown, source: WorkforceSource, now = Date.now()): asserts value is WorkforceRecords {
  if (!exact(value, WORKFORCE_COLLECTIONS)) reject('invalid_records');
  let total = 0;
  for (const collection of WORKFORCE_COLLECTIONS) {
    const rows = value[collection];
    if (!Array.isArray(rows) || rows.length > WORKFORCE_MAX_ROWS) reject('invalid_rows');
    total += rows.length;
    const seen = new Set<string>();
    for (const row of rows) {
      if (!exact(row, fields[collection]) || !commonRecord(row, now)) reject('invalid_record');
      const id = key(row);
      if (seen.has(id)) reject('duplicate_source_record');
      seen.add(id);
    }
  }
  const records = value as unknown as WorkforceRecords;
  if (total > WORKFORCE_MAX_ROWS || records.people.length > WORKFORCE_MAX_PEOPLE || records.units.length > WORKFORCE_MAX_UNITS) reject('invalid_rows');
  const units = new Map(records.units.map(row => [key(row), row]));
  const people = new Map(records.people.map(row => [key(row), row]));
  const unitRef = (ref: unknown, nullable = false) => reference(ref, ['organization', 'entity', 'facility'], nullable) && (ref === null || units.has(key(ref)));
  const personRef = (ref: unknown) => reference(ref, source === 'haven' ? ['staff'] : ['person']) && people.has(key(ref));
  for (const row of records.units) {
    if (!oneOf(row.record_type, source === 'haven' ? ['organization', 'entity', 'facility'] : ['organization', 'entity'])
      || !text(row.display_name) || !oneOf(row.unit_kind, ['business_group', 'legal_entity', 'facility', 'unknown']) || !nullableCode(row.source_kind)
      || !oneOf(row.source_status, ['active', 'inactive', 'suspended', 'under_renovation', 'archived', 'dissolved', 'merged', 'closed', 'unknown', null])
      || !unitRef(row.parent_ref, true) || !oneOf(row.parent_relation, ['source_scope', 'source_entity_parent', 'source_facility_entity', null])
      || (row.parent_ref === null) !== (row.parent_relation === null) || row.parent_ref && key(row.parent_ref) === key(row)
      || row.record_type === 'organization' && row.unit_kind !== 'business_group'
      || row.record_type === 'facility' && row.unit_kind !== 'facility'
      || row.record_type === 'entity' && !oneOf(row.unit_kind, ['legal_entity', 'unknown'])
      || row.parent_relation === 'source_scope' && row.parent_ref?.record_type !== 'organization'
      || row.parent_relation === 'source_entity_parent' && (row.record_type !== 'entity' || row.parent_ref?.record_type !== 'entity')
      || row.parent_relation === 'source_facility_entity' && (row.record_type !== 'facility' || row.parent_ref?.record_type !== 'entity')) reject('invalid_unit');
  }
  for (const row of records.people) {
    if (row.record_type !== (source === 'haven' ? 'staff' : 'person') || !text(row.display_name)
      || !oneOf(row.person_kind, source === 'haven' ? ['staff'] : ['employee', 'officer', 'sub_worker', 'contact', 'buyer', 'unknown'])
      || !nullableCode(row.staff_role) || !nullableText(row.job_title)
      || !oneOf(row.employment_status, ['active', 'on_leave', 'terminated', 'suspended', 'unknown'])
      || !unitRef(row.employer_ref, true) || row.employer_ref && units.get(key(row.employer_ref))?.unit_kind !== 'legal_entity'
      || ![row.source_hire_date, row.source_termination_date, row.last_day_worked, row.effective_employment_end, row.pay_basis_effective_from].every(date)
      || !timestamp(row.source_processed_at, now) || !oneOf(row.pay_basis, ['salary', 'hourly', 'other', 'unknown', null])
      || !oneOf(row.pay_basis_evidence, ['explicit_source', null])
      || row.pay_basis !== null && (row.pay_basis_evidence !== 'explicit_source' || row.pay_basis_effective_from === null)
      || row.pay_basis === null && (row.pay_basis_evidence !== null || row.pay_basis_effective_from !== null)
      || source === 'cornerstone' && row.staff_role !== null) reject('invalid_person');
  }
  const homes = new Set<string>();
  for (const row of records.assignments) {
    if (source !== 'haven' || !oneOf(row.record_type, ['staff_home', 'staff_facility_assignment'])
      || !personRef(row.person_ref) || !unitRef(row.unit_ref) || row.unit_ref.record_type !== 'facility'
      || !oneOf(row.assignment_kind, ['home', 'additional']) || !nullableCode(row.role_code) || !oneOf(row.source_is_primary, [true, false, null])
      || !sourceDates(row as unknown as ObjectValue) || (row.record_type === 'staff_home') !== (row.assignment_kind === 'home')) reject('invalid_assignment');
    if (row.assignment_kind === 'home') {
      if (homes.has(key(row.person_ref)) || row.source_record_id !== row.person_ref.source_record_id) reject('invalid_home_assignment');
      homes.add(key(row.person_ref));
    }
  }
  if (source === 'haven' && records.people.some(person => !homes.has(key(person)))) reject('missing_home_assignment');
  for (const row of records.roles) {
    if (!unitRef(row.unit_ref) || !nullableText(row.title) || !sourceDates(row as unknown as ObjectValue)
      || !oneOf(row.holder_resolution, ['resolved', 'unresolved', 'vacant'])
      || row.record_type !== (source === 'haven' ? 'facility_executive' : 'entity_officer') || row.role_code !== row.record_type
      || row.unit_ref.record_type !== (source === 'haven' ? 'facility' : 'entity')
      || row.date_kind !== (source === 'haven' ? 'effective' : 'signing')) reject('invalid_role');
    if (row.holder_resolution === 'vacant' && row.holder_ref !== null
      || row.holder_resolution === 'resolved' && !personRef(row.holder_ref)
      || row.holder_resolution === 'unresolved' && (source !== 'haven' || !reference(row.holder_ref, ['user']))) reject('invalid_role_holder');
  }
  for (const row of records.reporting) {
    if (row.record_type !== 'explicit_reporting' || !personRef(row.person_ref) || !personRef(row.manager_ref) || key(row.person_ref) === key(row.manager_ref)
      || !unitRef(row.unit_ref, true) || !oneOf(row.kind, ['primary', 'functional', 'acting']) || !sourceDates(row as unknown as ObjectValue)) reject('invalid_reporting');
  }
}

// JSON.parse accepts duplicate keys. Reject them (including escaped aliases) to avoid
// different publishers/receivers reading different facts from the same signed body.
function noDuplicateJsonKeys(json: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(json[index] ?? '') && index < json.length) index++; };
  const string = (): string => {
    const start = index++;
    while (index < json.length) {
      if (json[index] === '\\') { index += 2; continue; }
      if (json[index++] === '"') return JSON.parse(json.slice(start, index)) as string;
    }
    return reject('invalid_json');
  };
  const value = (depth: number): void => {
    if (depth > 12) reject('invalid_contract');
    whitespace();
    if (json[index] === '"') { string(); return; }
    if (json[index] === '{') {
      index++; whitespace(); const names = new Set<string>();
      while (json[index] !== '}') {
        whitespace(); const name = string(); if (names.has(name)) reject('duplicate_json_key'); names.add(name);
        whitespace(); index++; value(depth + 1); whitespace(); if (json[index] !== ',') break; index++;
      }
      index++; return;
    }
    if (json[index] === '[') {
      index++; whitespace();
      while (json[index] !== ']') { value(depth + 1); whitespace(); if (json[index] !== ',') break; index++; }
      index++; return;
    }
    while (index < json.length && !/[\s,}\]]/.test(json[index])) index++;
  };
  value(0);
}

export async function validateWorkforceRequest(input: {
  method: string; headers: Headers; raw: Uint8Array; contract: WorkforceSourceContract | null; secret: string | undefined; now?: number;
}): Promise<ValidatedWorkforceSnapshot> {
  const { method, headers, raw, contract, secret } = input; const now = input.now ?? Date.now();
  if (method !== 'POST') reject('method_not_allowed', 405);
  if (headers.get('content-type')?.trim().toLowerCase() !== 'application/json') reject('unsupported_content_type', 415);
  if (raw.byteLength === 0 || raw.byteLength > WORKFORCE_MAX_BYTES) reject('invalid_size', 413);
  const keyId = headers.get('x-workforce-key-id') ?? '';
  const sentAt = headers.get('x-workforce-sent-at') ?? '';
  const signature = headers.get('x-workforce-signature') ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !/^\d{10}$/.test(sentAt) || !/^[a-f0-9]{64}$/.test(signature)) reject('invalid_authentication', 401);
  if (!Number.isFinite(now) || Math.abs(now / 1000 - Number(sentAt)) > WORKFORCE_MAX_SKEW_SECONDS) reject('expired_request', 401);
  if (!contract || !contract.enabled || contract.key_id !== keyId || !oneOf(contract.source_system, ['haven', 'cornerstone'])
    || !identifier(contract.source_tenant_id) || contract.dataset !== WORKFORCE_DATASET || !secret || encoder.encode(secret).length < 32) reject('invalid_authentication', 401);
  const verificationKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, b => parseInt(b, 16));
  if (!await crypto.subtle.verify('HMAC', verificationKey, signatureBytes, workforceSigningBytes(contract, sentAt, raw))) reject('invalid_authentication', 401);
  let body: unknown;
  try { const json = decoder.decode(raw); body = JSON.parse(json); noDuplicateJsonKeys(json); }
  catch (error) { if (error instanceof WorkforceProtocolError) throw error; reject('invalid_json'); }
  if (!exact(body, ['source_system', 'source_tenant_id', 'dataset', 'contract_version', 'batch_id', 'sequence', 'source_as_of', 'mode', 'complete', 'counts', 'payload_sha256', 'records'])) reject('invalid_contract');
  if (body.source_system !== contract.source_system || body.source_tenant_id !== contract.source_tenant_id || body.dataset !== contract.dataset) reject('source_scope_denied', 403);
  if (body.contract_version !== WORKFORCE_VERSION || body.mode !== 'full' || body.complete !== true) reject('complete_snapshot_required');
  if (!identifier(body.batch_id) || !Number.isSafeInteger(body.sequence) || Number(body.sequence) < 1) reject('invalid_sequence_or_batch');
  if (!timestamp(body.source_as_of, now, false)) reject('invalid_source_as_of');
  validateWorkforceRecords(body.records, contract.source_system, now);
  // The source's organization record, when present, is its actual configured tenant.
  if (body.records.units.some(unit => unit.record_type === 'organization' && unit.source_record_id !== contract.source_tenant_id)) reject('source_scope_denied', 403);
  if (!exact(body.counts, WORKFORCE_COLLECTIONS)) reject('invalid_counts');
  for (const collection of WORKFORCE_COLLECTIONS) if (!Number.isSafeInteger(body.counts[collection]) || body.counts[collection] !== body.records[collection].length) reject('invalid_counts');
  const payloadHash = await workforcePayloadHash(body.records);
  if (body.payload_sha256 !== payloadHash) reject('payload_hash_mismatch');
  return { snapshot: body as unknown as WorkforceSnapshot, body_sha256: await workforceSha256(raw), payload_sha256: payloadHash, received_at: new Date(now).toISOString() };
}

export async function readBoundedWorkforceBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > WORKFORCE_MAX_BYTES) { await reader.cancel(); reject('invalid_size', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  return raw;
}
/** Persisted-state errors are reserved for the receiver. Never forward raw database messages. */
export const WORKFORCE_PUBLISHED_CODES = new Set([
  'method_not_allowed', 'unsupported_content_type', 'invalid_size', 'invalid_authentication', 'expired_request',
  'invalid_json', 'duplicate_json_key', 'invalid_contract', 'source_scope_denied', 'complete_snapshot_required',
  'invalid_sequence_or_batch', 'invalid_source_as_of', 'invalid_records', 'invalid_rows', 'invalid_record',
  'duplicate_source_record', 'invalid_unit', 'invalid_person', 'invalid_assignment', 'invalid_home_assignment',
  'missing_home_assignment', 'invalid_role', 'invalid_role_holder', 'invalid_reporting', 'invalid_counts', 'payload_hash_mismatch',
  'batch_payload_conflict', 'out_of_order_sequence', 'out_of_order_snapshot', 'source_disabled', 'snapshot_rejected',
]);
export function publishedWorkforceError(code: unknown): string { return typeof code === 'string' && WORKFORCE_PUBLISHED_CODES.has(code) ? code : 'snapshot_rejected'; }
