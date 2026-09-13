import { NextResponse } from "next/server";
import { requireOperationsActor,revalidateOperationsActor } from "@/lib/operations/auth";
import { providerContactCreateSchema,providerContactReplySchema,providerReportsReplySchema } from "@/lib/operations/provider-reports";
export async function POST(request:Request){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const parsed=providerContactCreateSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Enter a native contact name and type"},{status:400});
 const current=await revalidateOperationsActor(auth.actor);if("response" in current)return current.response;
 if(current.actor.id!==auth.actor.id||current.actor.organizationId!==auth.actor.organizationId||current.actor.appRole!==auth.actor.appRole)return NextResponse.json({error:"Current native contact authority required"},{status:404});
 const r=await current.actor.currentActor.client.rpc("create_provider_contact" as never,{p_task:parsed.data.task_id,p_request_key:parsed.data.request_key,p_name:parsed.data.name,p_contact_type:parsed.data.contact_type} as never);
 if(r.error)return NextResponse.json({error:"Native contact save could not be confirmed; retain this request for retry"},{status:r.error.code==="42501"?404:r.error.code==="23505"?409:503});
 const result=providerContactReplySchema.safeParse(r.data);if(!result.success||result.data.task_id!==parsed.data.task_id)return NextResponse.json({error:"Native contact response unavailable"},{status:503});
 const latest=await revalidateOperationsActor(current.actor);if("response" in latest)return latest.response;
 if(latest.actor.id!==auth.actor.id||latest.actor.organizationId!==auth.actor.organizationId||latest.actor.appRole!==auth.actor.appRole)return NextResponse.json({error:"Current native contact authority required"},{status:404});
 const fresh=await latest.actor.currentActor.client.rpc("provider_report_snapshot" as never,{p_task:parsed.data.task_id} as never);
 const checked=providerReportsReplySchema.safeParse(fresh.data);
 const input=checked.success?checked.data:null;
 const contact=input?.contacts.find(x=>x.id===result.data.contact.id);
 if(fresh.error||!contact||input?.task_id!==parsed.data.task_id||input?.resident_id!==result.data.resident_id)return NextResponse.json({error:"Current native contact access could not be confirmed"},{status:404});
 return NextResponse.json({...result.data,contact},{headers:{"Cache-Control":"no-store"}});
}
