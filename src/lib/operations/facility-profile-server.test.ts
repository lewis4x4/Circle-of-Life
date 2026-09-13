import { it, expect } from "vitest";
import type { OperationsActor } from "./auth";
import { readFacilityProfile } from "./facility-profile-server";
import { activityCatalog } from "./activity-catalog";
const id='00000000-0000-0000-0002-000000000003';
const sourceRows=()=>activityCatalog.entries.map(entry=>({id:`source-${entry.sourceId}`,organization_id:'org',source_item_id:entry.sourceId,source_file:activityCatalog.source.name,source_sha256:activityCatalog.source.sha256,source_payload:structuredClone(entry)}));
const mappingRows=()=>activityCatalog.entries.flatMap(entry=>entry.components.map(component=>({id:`mapping-${component.id}`,organization_id:'org',source_item_id:`source-${entry.sourceId}`,activity_id:component.id})));
function actor(fail=false, overrides: Record<string,unknown[]> = {}):OperationsActor {
 const data:Record<string,unknown[]>={facilities:[{id,name:'Homewood',organization_id:'org',entity_id:'entity',timezone:'America/New_York'}],entities:[{id:'entity',name:'Entity'}],operation_activity_source_items:sourceRows(),operation_activity_source_mappings:mappingRows(),operation_facility_requirements:Array.from({length:1001},(_,n)=>({id:`config-${n}`,facility_id:id,activity_id:n===1000?'e27fce0c-bace-4a06-8a1c-090a56fc8f8e':'other',requirement_version_id:null,status:'draft',effective_from:null,effective_to:null})),operation_requirement_versions:[],...overrides};
 return {organizationId:'org',appRole:'owner',currentActor:{client:{from:(table:string)=>{
  let columns:string[]=[];
  const project=(row:unknown)=>row&&typeof row==='object'?Object.fromEntries(columns.map(key=>[key,(row as Record<string,unknown>)[key]])):row;
  const q={select:(value:string)=>{columns=value.split(',');return q},eq:()=>q,is:()=>q,in:()=>q,order:()=>q,maybeSingle:async()=>({data:project(data[table][0]),error:null}),range:async(from:number,to:number)=>fail&&table==='operation_facility_requirements'&&from>0?{data:null,error:{message:'later page failed'}}:{data:data[table].slice(from,Math.min(to+1,from+73)).map(project),error:null}};return q;
 }}}} as unknown as OperationsActor;
}
it('reads beyond provider caps before composing all configuration pointers',async()=>{const p=await readFacilityProfile(actor(),id,new Date());expect(p!.entries.find(e=>e.source_id==='AL-W01')!.components[0].drafts.configuration_id).toBe('config-1000');expect(p!.coverage.component_count).toBe(110)});
it('rejects later page failure instead of a complete profile with missing configs',async()=>{await expect(readFacilityProfile(actor(true),id,new Date())).rejects.toThrow('retry the complete read')});
it('retrieves stored publication and approval provenance from the source',async()=>{
 const activity='e27fce0c-bace-4a06-8a1c-090a56fc8f8e';
 const authority={source:'Recorded policy',answer_id:'Q14',approver_id:'recorded-person',exceptions:'Retain raw recorded context'};
 const p=await readFacilityProfile(actor(false,{
  operation_requirement_versions:[{id:'req',activity_id:activity,version:2,status:'published',effective_from:'2026-01-01T00:00:00Z',effective_to:null,source_authority:authority,published_by:'publisher',published_at:'2025-12-30T12:00:00Z'}],
  operation_facility_requirements:[{id:'cfg',activity_id:activity,facility_id:id,requirement_version_id:'req',version:3,status:'published',effective_from:'2026-02-01T00:00:00Z',effective_to:null,approved_by:'site-approver',approved_at:'2026-01-30T12:00:00Z',override_source:'facility_policy',applicability_reason:'Local decision'}],
 }),id,new Date('2026-09-12T12:00:00Z'));
 const publication=p!.entries.find(e=>e.source_id==='AL-W01')!.components[0].publication;
 expect(publication?.requirement).toMatchObject({version:2,source_authority:authority,published_by:'publisher',published_at:'2025-12-30T12:00:00Z',effective_from:'2026-01-01T00:00:00Z'});
 expect(publication?.configuration).toMatchObject({version:3,approved_by:'site-approver',approved_at:'2026-01-30T12:00:00Z',override_source:'facility_policy',applicability_reason:'Local decision'});
});
it('uses actual authorized source payloads, preserving staged redactions instead of bundled names',async()=>{
 const rows=sourceRows();rows[0].source_payload.sourceText='Authorized staged wording';rows[0].source_payload.components[0].label='Authorized staged component';
 const p=await readFacilityProfile(actor(false,{operation_activity_source_items:rows}),id,new Date());
 expect(p!.entries[0].source_text).toBe('Authorized staged wording');
 expect(p!.entries[0].components[0].label).toBe('Authorized staged component');
});
it.each([
 {operation_activity_source_items:[]},
 {operation_activity_source_items:sourceRows().map(row=>({...row,organization_id:'other-org'}))},
 {operation_activity_source_items:sourceRows().map(row=>({...row,source_sha256:'0'.repeat(64)}))},
 {operation_activity_source_mappings:mappingRows().slice(1)},
])('does not certify an absent, foreign or incomplete source catalog',async overrides=>{
 await expect(readFacilityProfile(actor(false,overrides),id,new Date())).rejects.toThrow();
});
it('rejects swapped source payload identities even when total counts still reconcile',async()=>{
 const rows=sourceRows();[rows[0].source_payload,rows[1].source_payload]=[rows[1].source_payload,rows[0].source_payload];
 await expect(readFacilityProfile(actor(false,{operation_activity_source_items:rows}),id,new Date())).rejects.toThrow('identities changed');
});
