import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "@/lib/operations/auth";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { providerReportCommandSchema, providerReportsReplySchema } from "@/lib/operations/provider-reports";
const failure=(status=503)=>NextResponse.json({error:"Current native report scope or history could not be confirmed"},{status});
async function current(actor:OperationsActor){const r=await revalidateOperationsActor(actor);if("response" in r)return r;if(r.actor.id!==actor.id||r.actor.organizationId!==actor.organizationId||r.actor.appRole!==actor.appRole)return {response:failure(404)};return r;}
async function read(actor:OperationsActor,task:string){const {data,error}=await actor.currentActor.client.rpc("provider_report_snapshot" as never,{p_task:task} as never);const parsed=providerReportsReplySchema.safeParse(data);if(error||!parsed.success||parsed.data.task_id!==task)return failure(error?.code==="42501"?404:503);return NextResponse.json(parsed.data,{headers:{"Cache-Control":"no-store"}});}
export async function GET(request:Request){const auth=await requireOperationsActor();if("response" in auth)return auth.response;const task=new URL(request.url).searchParams.get("task_id");if(!databaseUuidSchema.safeParse(task).success)return failure(400);const live=await current(auth.actor);if("response" in live)return live.response;return read(live.actor,task!);}
export async function POST(request:Request){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const body=providerReportCommandSchema.safeParse(await request.json().catch(()=>null));if(!body.success)return failure(400);
 let live=await current(auth.actor);if("response" in live)return live.response;const {task_id,request_key,action,...payload}=body.data;
 const result=await live.actor.currentActor.client.rpc("provider_report_command" as never,{p_task:task_id,p_request_key:request_key,p_action:action,p_payload:payload} as never);
 if(result.error)return failure(result.error.code==="42501"?404:["40001","23505"].includes(result.error.code)?409:503);
 live=await current(live.actor);if("response" in live)return live.response;return read(live.actor,task_id);
}
