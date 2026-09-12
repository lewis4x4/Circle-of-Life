import { readAllOperationRows } from "@/lib/operations/read-all";
import { NextResponse } from "next/server";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { helpHandoverCommandSchema, helpHandoverTargetSchema, helpHandoverError, projectLocalDuties, type HelpHandoverEvent } from "@/lib/operations/help-handover";

export async function POST(request: Request) {
 const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
 if ("response" in auth) return auth.response;
 const parsed = helpHandoverCommandSchema.safeParse(await request.json().catch(() => null));
 if (!parsed.success) return NextResponse.json({ error: "Check the help or handover details" }, { status: 400 });
 if (!(await actorCanAccessFacility(auth.actor, parsed.data.facility_id))) return NextResponse.json({ error: "Operation unavailable" }, { status: 403 });
 const current = await revalidateOperationsActor(auth.actor);
 if ("response" in current) return current.response;
 const p = parsed.data;
 const { data, error } = await current.actor.currentActor.client.rpc("write_operation_help_handover_review" as never, { p_activity_id: p.activity_id, p_facility_id: p.facility_id, p_command: p.command, p_request_key: p.request_key, p_expected_id: p.expected_id, p_payload: p.payload } as never);
 if (error) { const mapped = helpHandoverError(error); return NextResponse.json({ error: mapped.error }, { status: mapped.status }); }
 const final = await revalidateOperationsActor(current.actor);
 if ("response" in final) return final.response;
 const result: unknown = data;
 if (!result || typeof result !== "object" || !("event" in result) || !("replayed" in result) || typeof result.replayed !== "boolean" || !result.event || typeof result.event !== "object" || !("id" in result.event) || typeof result.event.id !== "string") return NextResponse.json({error:"Outcome uncertain. Refresh before retrying."},{status:503});
 return NextResponse.json(result);
}
export async function GET(request: Request) {
 const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
 if ("response" in auth) return auth.response;
 const parsed = helpHandoverTargetSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if (!parsed.success) return NextResponse.json({ error: "Select an activity and facility" }, { status: 400 });
 const { activity_id, facility_id, occurrence_id } = parsed.data;
 if (!(await actorCanAccessFacility(auth.actor, facility_id))) return NextResponse.json({ error: "Operation unavailable" }, { status: 403 });
 const client = auth.actor.currentActor.client;
 // This RPC validates the activity/site/session under current authority before reads.
 const choices = await client.rpc("operation_help_handover_people_review" as never, { p_activity_id: activity_id, p_facility_id: facility_id } as never);
 if (choices.error) { const m = helpHandoverError(choices.error); return NextResponse.json({ error: m.error }, { status: m.status }); }
 const [history, issues, tasks] = await Promise.all([
  readAllOperationRows<HelpHandoverEvent>(() => client.from("operation_help_handover_events" as never).select("id,command,duty_scope,payload,actor_id,created_at,previous_id").eq("activity_id",activity_id).eq("facility_id",facility_id).order("created_at").order("id")),
  readAllOperationRows<Record<string, unknown>>(() => client.from("operation_issues" as never).select("id,summary,status,owner_user_id,backup_user_id,follow_up_at,task_instance_id").eq("activity_id",activity_id).eq("facility_id",facility_id).neq("status","resolved").order("id")),
  readAllOperationRows<Record<string, unknown>>(() => client.from("operation_task_instances" as never).select("id,template_name,status,assigned_to,due_at").eq("activity_id",activity_id).eq("facility_id",facility_id).in("status",["pending","in_progress","missed","deferred"]).is("deleted_at",null).order("id")),
 ]);
 if (history.error || issues.error || tasks.error) return NextResponse.json({ error: "Help and handover unavailable" }, { status: 503 });
 const events = (history.data ?? []) as unknown as HelpHandoverEvent[];
 // Generic facility document references only; raw storage paths and document
 // contents never enter this projection. Opening the vault rechecks authority.
 const helpHistory = events.filter(e => e.command === "help");
 for (const e of helpHistory) {
  const ids = Array.isArray(e.payload.protected_document_ids) ? e.payload.protected_document_ids as string[] : [];
  const docs = ids.length ? await client.from("facility_documents" as never).select("id,document_name").in("id",ids).eq("facility_id",facility_id).is("deleted_at",null) : { data: [], error: null };
  if (docs.error) return NextResponse.json({ error: "Help references unavailable" }, { status: 503 });
  const safe = { ...e.payload };
  delete safe.protected_document_ids;
  e.payload = { ...safe, protected_documents: (docs.data as unknown as {id:string;document_name:string}[]).map(d => ({ id:d.id,label:d.document_name,href:`/admin/facilities/${facility_id}/documents` })) };
 }
 let governingRequirement: unknown = null;
 let governingFacilityRequirement: unknown = null;
 if (occurrence_id) {
  const task = await client.from("operation_task_instances" as never).select("requirement_version_id,facility_requirement_id").eq("id",occurrence_id).eq("activity_id",activity_id).eq("facility_id",facility_id).is("deleted_at",null).maybeSingle();
  if (task.error || !task.data) return NextResponse.json({ error: "Occurrence unavailable" }, { status: 404 });
  const pinned = task.data as unknown as {requirement_version_id:string|null;facility_requirement_id:string|null};
  if (pinned.requirement_version_id) { const r = await client.from("operation_requirement_versions" as never).select("id,title,wording,procedure,version").eq("id",pinned.requirement_version_id).maybeSingle(); if (r.error) return NextResponse.json({error:"Governing rules unavailable"},{status:503}); governingRequirement=r.data; }
  if (pinned.facility_requirement_id) { const r = await client.from("operation_facility_requirements" as never).select("id,local_procedure,version,applicability,schedule_status,owner_role,owner_user_id,backup_role,backup_user_id,effective_from,effective_to").eq("id",pinned.facility_requirement_id).maybeSingle(); if (r.error) return NextResponse.json({error:"Governing rules unavailable"},{status:503}); governingFacilityRequirement=r.data; }
 }
 const finalChoices = await client.rpc("operation_help_handover_people_review" as never, {p_activity_id:activity_id,p_facility_id:facility_id} as never);
 if (finalChoices.error) {const m=helpHandoverError(finalChoices.error);return NextResponse.json({error:m.error},{status:m.status});}
 const current = await revalidateOperationsActor(auth.actor);
 if ("response" in current) return current.response;
 if (!(await actorCanAccessFacility(current.actor,facility_id))) return NextResponse.json({ error: "Operation unavailable" }, { status: 403 });
 const canManage = ["owner","org_admin","facility_admin"].includes(current.actor.appRole);
 return NextResponse.json({ actor_id: current.actor.id, facility_id, activity_id, can_publish:canManage, can_assign:canManage, people:finalChoices.data, help:helpHistory.at(-1) ?? null, help_history:helpHistory, duty_history:events.filter(e=>e.command!=="help"), current_duties:projectLocalDuties(events,Date.now(),(finalChoices.data as unknown as {id:string}[]).map(p=>p.id)), open_issues:issues.data, open_occurrences:tasks.data, governing_requirement:governingRequirement, governing_facility_requirement:governingFacilityRequirement });
}
