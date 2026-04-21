import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

const WORKFLOW_EVENTS_TABLE = "workflow_events" as never;
const ADMISSION_DOCUMENT_CHECKLIST_ITEMS_TABLE = "admission_document_checklist_items" as never;
const FORM_1823_RECORDS_TABLE = "form_1823_records" as never;

export type WorkflowEventInsert = {
  organization_id: string;
  facility_id: string;
  event_type:
    | "referral_admission_started"
    | "admission_case_updated"
    | "admission_status_changed"
    | "admission_move_in_blocked"
    | "form_1823_received"
    | "referral_converted"
    | "collection_activity_logged";
  source_module: string;
  event_key?: string | null;
  referral_lead_id?: string | null;
  admission_case_id?: string | null;
  resident_id?: string | null;
  invoice_id?: string | null;
  collection_activity_id?: string | null;
  payload_json?: Record<string, unknown>;
  created_by?: string | null;
};

export type AdmissionCaseWorkflowContext = {
  id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string;
  referral_lead_id: string | null;
  status: Database["public"]["Enums"]["admission_case_status"];
  financial_clearance_at: string | null;
  physician_orders_received_at: string | null;
  bed_id: string | null;
  target_move_in_date: string | null;
};

export type Form1823State = {
  record: {
    id: string;
    status: "pending" | "received" | "expired" | "renewal_due";
    physician_name: string | null;
    exam_date: string | null;
    expiration_date: string | null;
    updated_at: string;
  } | null;
  checklist: {
    id: string;
    received_at: string | null;
    notes: string | null;
    waived_reason: string | null;
  } | null;
  isSatisfied: boolean;
};

export async function emitWorkflowEvent(admin: AdminClient, event: WorkflowEventInsert) {
  const payload = {
    organization_id: event.organization_id,
    facility_id: event.facility_id,
    referral_lead_id: event.referral_lead_id ?? null,
    admission_case_id: event.admission_case_id ?? null,
    resident_id: event.resident_id ?? null,
    invoice_id: event.invoice_id ?? null,
    collection_activity_id: event.collection_activity_id ?? null,
    event_type: event.event_type,
    source_module: event.source_module,
    event_key: event.event_key ?? null,
    payload_json: event.payload_json ?? {},
    created_by: event.created_by ?? null,
  };

  const query = admin.from(WORKFLOW_EVENTS_TABLE);
  if (payload.event_key) {
    const { error } = await query.upsert(payload as never, {
      onConflict: "event_key",
      ignoreDuplicates: true,
    });
    if (error) throw error;
    return;
  }

  const { error } = await query.insert(payload as never);
  if (error) throw error;
}

export async function loadAdmissionCaseWorkflowContext(admin: AdminClient, admissionCaseId: string) {
  const { data, error } = await admin
    .from("admission_cases")
    .select("id, organization_id, facility_id, resident_id, referral_lead_id, status, financial_clearance_at, physician_orders_received_at, bed_id, target_move_in_date")
    .eq("id", admissionCaseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data as AdmissionCaseWorkflowContext | null;
}

export async function ensureForm1823Checklist(admin: AdminClient, args: {
  organizationId: string;
  facilityId: string;
  admissionCaseId: string;
  actorId: string | null;
}) {
  const { data: checklistData, error } = await admin
    .from(ADMISSION_DOCUMENT_CHECKLIST_ITEMS_TABLE)
    .select("id")
    .eq("admission_case_id", args.admissionCaseId)
    .eq("document_type", "form_1823")
    .is("deleted_at", null)
    .maybeSingle();

  const data = checklistData as { id: string } | null;

  if (error) throw error;
  if (data?.id) return data.id as string;

  const { data: insertedData, error: insertError } = await admin
    .from(ADMISSION_DOCUMENT_CHECKLIST_ITEMS_TABLE)
    .insert({
      organization_id: args.organizationId,
      facility_id: args.facilityId,
      admission_case_id: args.admissionCaseId,
      document_type: "form_1823",
      required: true,
      created_by: args.actorId,
      updated_by: args.actorId,
    } as never)
    .select("id")
    .single();

  const inserted = insertedData as { id: string } | null;

  if (insertError || !inserted) throw insertError ?? new Error("Failed to seed Form 1823 checklist item.");
  return inserted.id as string;
}

export async function loadAdmissionRateTermCount(admin: AdminClient, admissionCaseId: string) {
  const { count, error } = await admin
    .from("admission_case_rate_terms")
    .select("id", { head: true, count: "exact" })
    .eq("admission_case_id", admissionCaseId);

  if (error) throw error;
  return count ?? 0;
}

export async function loadForm1823State(admin: AdminClient, args: {
  admissionCaseId: string;
  residentId: string;
}) : Promise<Form1823State> {
  const [{ data: checklist }, { data: caseRecord }, { data: fallbackRecord }] = await Promise.all([
    admin
      .from(ADMISSION_DOCUMENT_CHECKLIST_ITEMS_TABLE)
      .select("id, received_at, notes, waived_reason")
      .eq("admission_case_id", args.admissionCaseId)
      .eq("document_type", "form_1823")
      .is("deleted_at", null)
      .maybeSingle(),
    admin
      .from(FORM_1823_RECORDS_TABLE)
      .select("id, status, physician_name, exam_date, expiration_date, updated_at")
      .eq("admission_case_id", args.admissionCaseId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from(FORM_1823_RECORDS_TABLE)
      .select("id, status, physician_name, exam_date, expiration_date, updated_at")
      .eq("resident_id", args.residentId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const record = (caseRecord ?? fallbackRecord ?? null) as unknown as Form1823State["record"];
  const checklistRow = checklist as unknown as Form1823State["checklist"];
  const isSatisfied = Boolean(record?.status === "received" && checklistRow?.received_at);

  return {
    record,
    checklist: checklistRow,
    isSatisfied,
  };
}

export async function upsertAdmissionForm1823(admin: AdminClient, args: {
  organizationId: string;
  facilityId: string;
  admissionCaseId: string;
  residentId: string;
  actorId: string | null;
  status: "pending" | "received" | "expired" | "renewal_due";
  physicianName: string | null;
  examDate: string | null;
  expirationDate: string | null;
  notes: string | null;
}) {
  await ensureForm1823Checklist(admin, {
    organizationId: args.organizationId,
    facilityId: args.facilityId,
    admissionCaseId: args.admissionCaseId,
    actorId: args.actorId,
  });

  const { data: existingData, error: existingError } = await admin
    .from(FORM_1823_RECORDS_TABLE)
    .select("id")
    .eq("admission_case_id", args.admissionCaseId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existing = existingData as { id: string } | null;

  if (existingError) throw existingError;

  const recordPayload = {
    organization_id: args.organizationId,
    facility_id: args.facilityId,
    resident_id: args.residentId,
    admission_case_id: args.admissionCaseId,
    physician_name: args.physicianName,
    exam_date: args.examDate,
    expiration_date: args.expirationDate,
    status: args.status,
    updated_by: args.actorId,
  };

  if (existing?.id) {
    const { error } = await admin
      .from(FORM_1823_RECORDS_TABLE)
      .update(recordPayload as never)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from(FORM_1823_RECORDS_TABLE)
      .insert({
        ...recordPayload,
        created_by: args.actorId,
      } as never);
    if (error) throw error;
  }

  const { error: checklistError } = await admin
    .from(ADMISSION_DOCUMENT_CHECKLIST_ITEMS_TABLE)
    .update({
      received_at: args.status === "received" ? new Date().toISOString() : null,
      waived_reason: null,
      notes: args.notes,
      updated_by: args.actorId,
    } as never)
    .eq("admission_case_id", args.admissionCaseId)
    .eq("document_type", "form_1823")
    .is("deleted_at", null);

  if (checklistError) throw checklistError;

  return loadForm1823State(admin, {
    admissionCaseId: args.admissionCaseId,
    residentId: args.residentId,
  });
}

export async function syncLeadToApplicationPending(admin: AdminClient, args: {
  leadId: string;
  actorId: string | null;
}) {
  const { data: leadData, error } = await admin
    .from("referral_leads")
    .select("id, status")
    .eq("id", args.leadId)
    .is("deleted_at", null)
    .maybeSingle();

  const lead = leadData as { id: string; status: string } | null;

  if (error) throw error;
  if (!lead) return;
  if (["application_pending", "waitlisted", "converted", "lost", "merged"].includes(lead.status)) return;

  const { error: updateError } = await admin
    .from("referral_leads")
    .update({
      status: "application_pending",
      updated_at: new Date().toISOString(),
      updated_by: args.actorId,
    })
    .eq("id", args.leadId);

  if (updateError) throw updateError;
}

export async function convertLeadOnMoveIn(admin: AdminClient, args: {
  leadId: string;
  residentId: string;
  actorId: string | null;
}) {
  const { error } = await admin
    .from("referral_leads")
    .update({
      status: "converted",
      converted_resident_id: args.residentId,
      converted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: args.actorId,
    })
    .eq("id", args.leadId)
    .is("deleted_at", null);

  if (error) throw error;
}
