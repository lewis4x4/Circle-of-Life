import { createHash } from "node:crypto";
import type { CurrentApiActor } from "@/lib/auth/current-api-actor";
import { revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { buildPayrollSnapshot } from "./compute";
import { buildPayrollPacketCsv, buildPayrollPacketHtml, buildPayrollPacketPdf } from "./documents";
import { createPacketSchema, payrollPolicySchema, type packetActionSchema } from "./validation";
import type { z } from "zod";
import type { PacketDetail, PacketEvent, PacketHub, PacketInput, PacketSnapshot, PayrollPacket, PayrollPolicyRecord, PayrollSource } from "./types";

export const PACKET_ROLES = ["owner", "org_admin", "facility_admin"] as const;
export class PayrollPacketError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const PACKET_FIELDS = "id,root_id,amends_packet_id,version,revision,organization_id,facility_id,period_start,period_end,check_date,status,inputs,snapshot,source_revision,policy_revision,created_at,created_by,created_by_name,updated_at,approved_at,approved_by,approved_by_name,document_hash,reported_at,reported_by,reported_by_name,report_method,report_reference,reconciled_at,reconciled_by,reconciled_by_name,reconciliation_note,amendment_reason";
type DbError = { message: string; code?: string };
const databaseMessages: Record<string, [string, number]> = {
  payroll_access_denied: ["You no longer have access to this facility's payroll.", 403],
  payroll_approval_denied: ["This packet requires approval by the owner or organization administrator.", 403],
  payroll_packet_not_found: ["Payroll packet not found.", 404],
  payroll_revision_conflict: ["This packet or its rules changed. Reload before continuing.", 409],
  payroll_source_stale: ["Time records changed. Refresh and review the draft before approving.", 409],
  payroll_policy_stale: ["Payroll rules changed. Refresh and review the draft.", 409],
  payroll_policy_snapshot_invalid: ["Payroll rules changed. Refresh and review the draft.", 409],
  payroll_policy_incomplete: ["Complete every payroll rule and confirm the employer facilities before confirming.", 422],
  payroll_policy_invalid: ["Review the payroll rule values and selected employer facilities.", 422],
  payroll_approval_blocked: ["Resolve the outstanding payroll review items and confirm the rules before approval.", 409],
  payroll_packet_immutable: ["Approved packet contents are retained. Create an amendment for corrections.", 409],
  payroll_packet_identity_immutable: ["The packet period cannot change. Prepare a separate packet for another period.", 409],
  payroll_amendment_invalid: ["Choose an approved packet and enter a reason for the amendment.", 422],
  payroll_amendment_superseded: ["A newer version or draft already exists. Open the latest version.", 409],
  payroll_report_blocked: ["Only the latest approved packet can be marked reported. Review any newer amendment first.", 409],
  payroll_report_invalid: ["Choose Phone or RUN and record a confirmation reference or call note.", 422],
  payroll_reconciliation_invalid: ["Report the packet first and record the ADP comparison details.", 422],
  payroll_reconciliation_mismatch: ["Record and resolve the differences before marking the packet reconciled.", 422],
  payroll_packet_invalid: ["The packet could not be matched to its employee data and dates. Refresh and review it.", 422],
  payroll_document_invalid: ["The approved document could not be verified. No approval was recorded.", 503],
};
function check(error: DbError | null) {
  if (!error) return;
  const known = databaseMessages[error.message];
  if (known) throw new PayrollPacketError(...known);
  if (error.code === "23505") throw new PayrollPacketError("A packet or draft amendment already exists for this period. Refresh the list.");
  throw new PayrollPacketError("Payroll data could not be loaded or saved. Refresh and try again.", 503);
}
async function rpc<T>(actor: CurrentApiActor, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await actor.admin.rpc(name as never, args as never);
  check(error);
  if (data === null) throw new PayrollPacketError("The payroll request returned no result.", 503);
  return data as unknown as T;
}
export async function assertPacketFacility(actor: CurrentApiActor, facilityId: string) {
  if (!await serviceRoleUserHasFacilityAccess(actor.admin, { userId: actor.id, organizationId: actor.organizationId, facilityId })) {
    throw new PayrollPacketError("Payroll facility not found.", 404);
  }
}
async function freshActor(actor: CurrentApiActor): Promise<CurrentApiActor> {
  const result = await revalidateCurrentApiActor(actor, { allowedRoles: PACKET_ROLES, scope: "payroll-packets.revalidate" });
  if ("response" in result || result.actor.organizationId !== actor.organizationId) throw new PayrollPacketError("Sign in again before continuing.", 401);
  return result.actor;
}
export async function getPacketPolicy(actor: CurrentApiActor, facilityId: string): Promise<PayrollPolicyRecord | null> {
  await assertPacketFacility(actor, facilityId);
  const { data, error } = await actor.admin.from("payroll_packet_policies" as never).select("*").eq("organization_id", actor.organizationId).eq("facility_id", facilityId).maybeSingle();
  check(error);
  return data as unknown as PayrollPolicyRecord | null;
}
export async function savePacketPolicy(actor: CurrentApiActor, input: { facilityId: string; config: unknown; confirm: boolean; expectedRevision: number }) {
  if (!["owner", "org_admin"].includes(actor.appRole)) throw new PayrollPacketError("An owner or organization administrator must configure payroll rules.", 403);
  await assertPacketFacility(actor, input.facilityId);
  if (input.confirm) payrollPolicySchema.parse(input.config);
  const current = await freshActor(actor);
  return rpc<PayrollPolicyRecord>(current, "payroll_packet_policy_save", { p_actor_id: current.id, p_facility_id: input.facilityId, p_config: input.config, p_confirm: input.confirm, p_expected_revision: input.expectedRevision });
}
async function sourceRevision(actor: CurrentApiActor, facilityId: string): Promise<string> {
  return String(await rpc<string>(actor, "payroll_packet_revision", { p_actor_id: actor.id, p_facility_id: facilityId }));
}
async function sourceKind<T>(actor: CurrentApiActor, facilityId: string, kind: string): Promise<T[]> {
  const result: T[] = [];
  let count: number | null = null;
  do {
    const page = await rpc<{ data: T[]; count: number }>(actor, "payroll_packet_source_page", { p_actor_id: actor.id, p_facility_id: facilityId, p_kind: kind, p_offset: result.length, p_limit: 500 });
    if (!Number.isInteger(page.count) || page.count < 0 || page.count > 100000 || !Array.isArray(page.data)) throw new PayrollPacketError("The payroll source is too large or incomplete. No partial packet was created.");
    count ??= page.count;
    if (page.count !== count || (result.length < count && page.data.length === 0)) throw new PayrollPacketError("Time records changed while loading. Refresh the packet.");
    result.push(...page.data);
    if (result.length > count) throw new PayrollPacketError("The payroll source count could not be reconciled.");
  } while (result.length < count);
  return result;
}
export async function loadPayrollSource(actor: CurrentApiActor, facilityId: string): Promise<PayrollSource> {
  await assertPacketFacility(actor, facilityId);
  const before = await sourceRevision(actor, facilityId);
  const [policy, facility, people, punches, corrections, rejections, floorUnlocks] = await Promise.all([
    getPacketPolicy(actor, facilityId),
    actor.admin.from("facilities").select("name").eq("id", facilityId).eq("organization_id", actor.organizationId).is("deleted_at", null).single(),
    sourceKind<PayrollSource["people"][number]>(actor, facilityId, "people"),
    sourceKind<PayrollSource["punches"][number]>(actor, facilityId, "punches"),
    sourceKind<PayrollSource["corrections"][number]>(actor, facilityId, "corrections"),
    sourceKind<PayrollSource["rejections"][number]>(actor, facilityId, "rejections"),
    sourceKind<PayrollSource["floorUnlocks"][number]>(actor, facilityId, "floorUnlocks"),
  ]);
  check(facility.error);
  if (!facility.data) throw new PayrollPacketError("Payroll facility not found.", 404);
  const groupIds = policy?.config.overtimeFacilityIds ?? [facilityId];
  const group = await actor.admin.from("payroll_packet_policies" as never).select("*").eq("organization_id", actor.organizationId).in("facility_id", groupIds);
  check(group.error);
  const after = await sourceRevision(actor, facilityId);
  if (before !== after) throw new PayrollPacketError("Time records or payroll settings changed while loading. Refresh the packet.");
  return { facilityId, facilityName: facility.data.name, sourceRevision: after, policy, groupPolicies: (group.data ?? []) as unknown as PayrollPolicyRecord[], people, punches, corrections, rejections, floorUnlocks };
}
export async function getPacketHub(actor: CurrentApiActor, facilityId: string): Promise<PacketHub> {
  await assertPacketFacility(actor, facilityId);
  const canConfigure = ["owner", "org_admin"].includes(actor.appRole);
  const [packets, policy, facilities] = await Promise.all([
    readAllPages((from, to) => actor.admin.from("payroll_packets" as never).select(PACKET_FIELDS, { count: "exact" }).eq("organization_id", actor.organizationId).eq("facility_id", facilityId).order("period_start", { ascending: false }).order("version", { ascending: false }).order("id").range(from, to)),
    getPacketPolicy(actor, facilityId),
    canConfigure ? actor.admin.from("facilities").select("id,name").eq("organization_id", actor.organizationId).is("deleted_at", null).order("name") : actor.admin.from("facilities").select("id,name").eq("organization_id", actor.organizationId).eq("id", facilityId).is("deleted_at", null),
  ]);
  check(facilities.error);
  return { packets: packets.data as unknown as PayrollPacket[], policy, facilities: facilities.data ?? [], canConfigure };
}
export async function getPayrollPacket(actor: CurrentApiActor, id: string): Promise<PayrollPacket> {
  const { data, error } = await actor.admin.from("payroll_packets" as never).select(PACKET_FIELDS).eq("id", id).eq("organization_id", actor.organizationId).maybeSingle();
  check(error);
  if (!data) throw new PayrollPacketError("Payroll packet not found.", 404);
  const packet = data as unknown as PayrollPacket;
  await assertPacketFacility(actor, packet.facility_id);
  return packet;
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}
export function snapshotFingerprint(snapshot: PacketSnapshot): string {
  const { generatedAt: _generatedAt, sourceRevision: _sourceRevision, ...business } = snapshot;
  void _generatedAt; void _sourceRevision;
  return createHash("sha256").update(JSON.stringify(ordered(business))).digest("hex");
}
function buildSnapshot(source: PayrollSource, dates: { periodStart: string; periodEnd: string; checkDate: string }, inputs: PacketInput[]) {
  const people = new Set(source.people.map((person) => person.id));
  if (inputs.some((row) => !people.has(row.staffId))) throw new PayrollPacketError("An employee is no longer available in this payroll scope. Review the roster.");
  return buildPayrollSnapshot(source, { ...dates, inputs, now: new Date() });
}
const datesFor = (packet: PayrollPacket) => ({ periodStart: packet.period_start, periodEnd: packet.period_end, checkDate: packet.check_date });
async function writePacket(actor: CurrentApiActor, source: PayrollSource, dates: { periodStart: string; periodEnd: string; checkDate: string }, inputs: PacketInput[], snapshot: PacketSnapshot, packet: PayrollPacket | null, amendment?: { id: string; reason: string }) {
  const current = await freshActor(actor);
  return rpc<PayrollPacket>(current, "payroll_packet_write", {
    p_actor_id: current.id, p_facility_id: source.facilityId, p_packet_id: packet?.id ?? null, p_expected_revision: packet?.revision ?? 0,
    p_source_revision: source.sourceRevision, p_policy_revision: source.policy?.revision ?? 0,
    p_period_start: dates.periodStart, p_period_end: dates.periodEnd, p_check_date: dates.checkDate,
    p_inputs: inputs, p_snapshot: snapshot, p_amends_packet_id: amendment?.id ?? packet?.amends_packet_id ?? null, p_amendment_reason: amendment?.reason ?? packet?.amendment_reason ?? null,
  });
}
export async function createPayrollPacket(actor: CurrentApiActor, dates: { facilityId: string; periodStart: string; periodEnd: string; checkDate: string }) {
  const source = await loadPayrollSource(actor, dates.facilityId);
  const snapshot = buildSnapshot(source, dates, []);
  const inputs = snapshot.rows.map(({ staffId, payrollId, payBasis, department, regularMinutes, overtimeMinutes, holidayMinutes, personalMinutes, trainingMinutes, onCallCents, bonusCents, salaryCents, note, reason, reviewed }) => ({ staffId, payrollId, payBasis, department, regularMinutes, overtimeMinutes, holidayMinutes, personalMinutes, trainingMinutes, onCallCents, bonusCents, salaryCents, note, reason, reviewed }));
  return writePacket(actor, source, dates, inputs, snapshot, null);
}
export async function getPacketDetail(actor: CurrentApiActor, id: string): Promise<PacketDetail> {
  const packet = await getPayrollPacket(actor, id);
  const [events, versions, revision] = await Promise.all([
    readAllPages((from, to) => actor.admin.from("payroll_packet_events" as never).select("id,packet_id,action,actor_id,actor_name,created_at,detail", { count: "exact" }).eq("packet_id", id).eq("organization_id", actor.organizationId).order("created_at").order("id").range(from, to)),
    actor.admin.from("payroll_packets" as never).select("id,version,status").eq("root_id", packet.root_id).eq("organization_id", actor.organizationId).eq("facility_id", packet.facility_id).order("version"),
    sourceRevision(actor, packet.facility_id),
  ]);
  check(versions.error);
  let stale = revision !== String(packet.source_revision);
  if (stale) {
    try { stale = snapshotFingerprint(buildSnapshot(await loadPayrollSource(actor, packet.facility_id), datesFor(packet), packet.inputs)) !== snapshotFingerprint(packet.snapshot); }
    catch { stale = true; }
  }
  return { packet, events: events.data as unknown as PacketEvent[], versions: (versions.data ?? []) as unknown as PacketDetail["versions"], stale };
}
export async function actOnPayrollPacket(actor: CurrentApiActor, id: string, input: z.infer<typeof packetActionSchema>): Promise<PayrollPacket> {
  let packet = await getPayrollPacket(actor, id);
  if (packet.revision !== input.expectedRevision) throw new PayrollPacketError("This packet changed. Reload before continuing.");
  if (input.action === "save" || input.action === "refresh" || input.action === "amend") {
    if (input.action !== "amend" && packet.status !== "draft") throw new PayrollPacketError("Approved packet contents cannot be changed. Create an amendment.");
    if (input.action === "amend" && packet.status === "draft") throw new PayrollPacketError("Save the existing draft instead of creating an amendment.");
    const source = await loadPayrollSource(actor, packet.facility_id);
    const inputs = input.action === "save" ? input.inputs : packet.inputs.map((row) => ({ ...row, reviewed: false }));
    const dates = createPacketSchema.parse({ facilityId: packet.facility_id, ...datesFor(packet), ...(input.action === "save" && input.checkDate ? { checkDate: input.checkDate } : {}) });
    const snapshot = buildSnapshot(source, dates, inputs);
    return writePacket(actor, source, dates, inputs, snapshot, input.action === "amend" ? null : packet, input.action === "amend" ? { id: packet.id, reason: input.reason } : undefined);
  }
  if (input.action === "approve") {
    if (packet.status !== "draft") throw new PayrollPacketError("Only a draft can be approved.");
    const source = await loadPayrollSource(actor, packet.facility_id);
    const snapshot = buildSnapshot(source, datesFor(packet), packet.inputs);
    if (snapshotFingerprint(snapshot) !== snapshotFingerprint(packet.snapshot)) throw new PayrollPacketError("The source timecards or payroll rules changed. Refresh and review the draft before approving.");
    if (snapshot.blockers.length) throw new PayrollPacketError("Resolve the packet's outstanding review items before approval.");
    if (String(packet.source_revision) !== source.sourceRevision) packet = await writePacket(actor, source, datesFor(packet), packet.inputs, snapshot, packet);
    const current = await freshActor(actor);
    const approvedAt = new Date().toISOString();
    const approvedByName = current.fullName ?? "";
    const approved = { ...packet, status: "approved" as const, approved_at: approvedAt, approved_by: current.id, approved_by_name: approvedByName };
    const pdf = buildPayrollPacketPdf(approved);
    const html = buildPayrollPacketHtml(approved);
    return rpc<PayrollPacket>(current, "payroll_packet_action", { p_actor_id: current.id, p_packet_id: id, p_expected_revision: packet.revision, p_action: "approve", p_detail: { approvedAt, approvedByName, pdfBase64: pdf.toString("base64"), html, csv: buildPayrollPacketCsv(approved), documentHash: createHash("sha256").update(pdf).digest("hex") } });
  }
  const current = await freshActor(actor);
  const detail = input.action === "report" ? { method: input.method, reference: input.reference } : input.action === "reconcile" ? { matches: input.matches, note: input.note } : { note: input.note };
  return rpc<PayrollPacket>(current, "payroll_packet_action", { p_actor_id: current.id, p_packet_id: id, p_expected_revision: packet.revision, p_action: input.action, p_detail: detail });
}
export async function payrollDocument(actor: CurrentApiActor, id: string, format: "pdf" | "html" | "csv") {
  const packet = await getPayrollPacket(actor, id);
  const current = await freshActor(actor);
  await assertPacketFacility(current, packet.facility_id);
  const type = format === "pdf" ? "application/pdf" : format === "csv" ? "text/csv; charset=utf-8" : "text/html; charset=utf-8";
  if (packet.status === "draft") return { body: format === "pdf" ? buildPayrollPacketPdf(packet) : format === "csv" ? buildPayrollPacketCsv(packet) : buildPayrollPacketHtml(packet), type, extension: format, packet };
  const { data, error } = await current.admin.from("payroll_packets" as never).select("approved_pdf_base64,approved_html,approved_csv,document_hash").eq("id", id).eq("organization_id", current.organizationId).eq("facility_id", packet.facility_id).single();
  check(error);
  const artifact = data as unknown as { approved_pdf_base64: string | null; approved_html: string | null; approved_csv: string | null; document_hash: string | null };
  if (!artifact?.approved_pdf_base64 || !artifact.approved_html || !artifact.approved_csv || !artifact.document_hash) throw new PayrollPacketError("The approved document is unavailable. No replacement has been generated.", 503);
  const pdf = Buffer.from(artifact.approved_pdf_base64, "base64");
  if (createHash("sha256").update(pdf).digest("hex") !== artifact.document_hash) throw new PayrollPacketError("The approved document could not be verified.", 503);
  return { body: format === "pdf" ? pdf : format === "csv" ? artifact.approved_csv : artifact.approved_html, type, extension: format, packet };
}
