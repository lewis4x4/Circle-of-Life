import { createHash } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor, type OperationsActor } from "./auth";
import { databaseUuidSchema as uuid } from "./database-uuid";
import { PROVIDER_DOCUMENT_BUCKET, providerDocumentPrepareSchema, providerDocumentFinalizeSchema, providerDocumentVersionSchema } from "./provider-reports";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
const targetSchema=z.object({task_id:uuid,resident_id:uuid,version:providerDocumentVersionSchema,uploader_id:uuid,object:z.object({id:uuid,version:z.string(),etag:z.string(),size:z.number(),mime:z.string()}).strict().nullable()}).strict();
const fail=(status=503)=>NextResponse.json({error:"Native document access or verified bytes could not be confirmed"},{status});
async function current(actor:OperationsActor){const next=await revalidateOperationsActor(actor);if("response" in next)return next;if(next.actor.id!==actor.id||next.actor.organizationId!==actor.organizationId||next.actor.appRole!==actor.appRole)return {response:fail(404)};return next;}
async function target(actor:OperationsActor,task:string,version:string){const r=await actor.currentActor.client.rpc("provider_document_target" as never,{p_task:task,p_version:version} as never);const parsed=targetSchema.safeParse(r.data);if(r.error||!parsed.success||parsed.data.task_id!==task||parsed.data.version.resident_id!==parsed.data.resident_id||parsed.data.version.id!==version)return null;const v=parsed.data.version;if(v.object_path!==`${v.facility_id}/${v.document_id}/${v.id}/source`)return null;return parsed.data;}
class ProviderDocumentValidationError extends Error {}
export function validateProviderDocumentBytes(bytes:Uint8Array,mime:string,size:number,sha:string){
 if(bytes.byteLength!==size||size<1||size>20971520)throw new ProviderDocumentValidationError("Document size mismatch");
 const header=Buffer.from(bytes.subarray(0,12));
 const valid=mime==="application/pdf"?header.subarray(0,5).toString()==="%PDF-":mime==="image/png"?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==="image/jpeg"&&header[0]===255&&header[1]===216&&header[2]===255;
 if(!valid)throw new ProviderDocumentValidationError("Document format mismatch");
 const actual=createHash("sha256").update(bytes).digest("hex");if(actual!==sha)throw new ProviderDocumentValidationError("Document checksum mismatch");
 return {sha256:actual,md5:createHash("md5").update(bytes).digest("hex")};
}
export async function prepareProviderDocument(request:Request){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const parsed=providerDocumentPrepareSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return fail(400);
 const live=await current(auth.actor);if("response" in live)return live.response;const {task_id,request_key,...payload}=parsed.data;
 const r=await live.actor.currentActor.client.rpc("prepare_provider_document" as never,{p_task:task_id,p_request_key:request_key,p_payload:payload} as never);
 if(r.error)return fail(r.error.code==="42501"?404:r.error.code==="23505"?409:503);
 const reply=z.object({version:providerDocumentVersionSchema}).strict().safeParse(r.data);if(!reply.success)return fail();
 const final=await current(live.actor);if("response" in final)return final.response;const fresh=await target(final.actor,task_id,reply.data.version.id);if(!fresh)return fail(404);
 return NextResponse.json({version:fresh.version},{headers:{"Cache-Control":"no-store"}});
}
export async function finalizeProviderDocument(request:Request,id:string){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const body=providerDocumentFinalizeSchema.safeParse(await request.json().catch(()=>null));if(!uuid.safeParse(id).success||!body.success)return fail(400);
 let live=await current(auth.actor);if("response" in live)return live.response;const before=await target(live.actor,body.data.task_id,id);if(!before||!before.object)return fail(404);
 try{
  const result=await live.actor.currentActor.client.storage.from(PROVIDER_DOCUMENT_BUCKET).download(before.version.object_path);if(result.error||!result.data)return fail(404);
  const bytes=new Uint8Array(await result.data.arrayBuffer());const hashes=validateProviderDocumentBytes(bytes,before.version.declared_mime,before.version.declared_size_bytes,before.version.declared_sha256);
  live=await current(live.actor);if("response" in live)return live.response;const after=await target(live.actor,body.data.task_id,id);
  if(!after?.object||JSON.stringify(before)!==JSON.stringify(after)||after.object.etag!==hashes.md5||after.object.size!==bytes.length||after.object.mime!==before.version.declared_mime)return fail(409);
  const attest=await createServiceRoleClient().rpc("attest_resident_document_bytes" as never,{p_version:id,p_object:after.object.id,p_object_version:after.object.version,p_etag:after.object.etag,p_size:bytes.length,p_mime:after.object.mime,p_sha256:hashes.sha256,p_md5:hashes.md5,p_uploader:after.uploader_id} as never);
  if(attest.error)return fail();
  live=await current(live.actor);if("response" in live)return live.response;
  const r=await live.actor.currentActor.client.rpc("finalize_provider_document" as never,{p_task:body.data.task_id,p_version:id,p_request_key:body.data.request_key,p_expected_revision:body.data.expected_revision} as never);
  if(r.error)return fail(r.error.code==="42501"?404:["23505","40001"].includes(r.error.code)?409:503);
  live=await current(live.actor);if("response" in live)return live.response;const final=await target(live.actor,body.data.task_id,id);if(!final||final.version.state!=="finalized")return fail();
  return NextResponse.json({version:final.version},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return fail(error instanceof ProviderDocumentValidationError?409:503);}
}
export async function downloadProviderDocument(request:Request,id:string){
 const auth=await requireOperationsActor();if("response" in auth)return auth.response;const task=new URL(request.url).searchParams.get("task_id");if(!uuid.safeParse(id).success||!uuid.safeParse(task).success)return fail(400);
 let live=await current(auth.actor);if("response" in live)return live.response;const before=await target(live.actor,task!,id);if(!before?.object||before.version.state!=="finalized")return fail(404);
 try{
  const r=await live.actor.currentActor.client.storage.from(PROVIDER_DOCUMENT_BUCKET).download(before.version.object_path);if(r.error||!r.data)return fail(404);const bytes=new Uint8Array(await r.data.arrayBuffer());validateProviderDocumentBytes(bytes,before.version.declared_mime,before.version.declared_size_bytes,before.version.declared_sha256);
  live=await current(live.actor);if("response" in live)return live.response;const after=await target(live.actor,task!,id);if(!after||JSON.stringify(after)!==JSON.stringify(before))return fail(409);
  return new Response(bytes,{headers:{"Content-Type":before.version.declared_mime,"Content-Length":String(bytes.length),"Content-Disposition":`attachment; filename="report-${id}.${before.version.declared_mime==="application/pdf"?"pdf":before.version.declared_mime==="image/png"?"png":"jpg"}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){return fail(error instanceof ProviderDocumentValidationError?409:503);}
}
