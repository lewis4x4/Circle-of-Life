import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { corporateDeliverableHistorySchema } from "@/lib/operations/corporate-deliverables";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
export async function GET(request:Request){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const query=new URL(request.url).searchParams;const task=query.get("task_id"),expectation=query.get("expectation_id"),beforeVersion=query.get("before_version"),beforeSequence=query.get("before_sequence");
 if(!databaseUuidSchema.safeParse(task).success||!databaseUuidSchema.safeParse(expectation).success||beforeVersion!==null&&!/^\d+$/.test(beforeVersion)||beforeSequence!==null&&!/^\d+$/.test(beforeSequence))return NextResponse.json({error:"Bounded corporate history cursor required"},{status:400});
 const live=await revalidateOperationsActor(auth.actor);if("response" in live)return live.response;if(live.actor.id!==auth.actor.id||live.actor.organizationId!==auth.actor.organizationId||live.actor.appRole!==auth.actor.appRole)return NextResponse.json({error:"Corporate history unavailable"},{status:404});
 const result=await live.actor.currentActor.client.rpc("corporate_deliverable_history" as never,{p_task:task,p_expectation:expectation,p_before_version:beforeVersion?Number(beforeVersion):null,p_before_sequence:beforeSequence?Number(beforeSequence):null} as never);const parsed=corporateDeliverableHistorySchema.safeParse(result.data);
 if(result.error||!parsed.success||parsed.data.task_id!==task||parsed.data.expectation_id!==expectation||JSON.stringify(parsed.data).length>1_048_576)return NextResponse.json({error:"Corporate history unavailable"},{status:result.error?.code==="42501"?404:result.error?.code==="54000"?413:503});
 return NextResponse.json(parsed.data,{headers:{"Cache-Control":"no-store"}});
}
