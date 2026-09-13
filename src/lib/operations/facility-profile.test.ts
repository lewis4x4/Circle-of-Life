import { describe, it, expect } from "vitest";
import { buildFacilityProfile, validateProfileRuleProposal, type ProfileFacility, type ApprovedProfileRule } from "./facility-profile";
const site: ProfileFacility = { id: "00000000-0000-0000-0002-000000000003", organization_id: "00000000-0000-0000-0000-000000000001", entity_id: "00000000-0000-0000-0001-000000000003", name: "Homewood Lodge", entity_name: "Sorensen, Smith & Bay LLC", timezone: "America/New_York" };
it("covers all91 source items and110 components without inferred rules", () => {
 const p=buildFacilityProfile(site,[],[]);
 expect(p.coverage).toEqual({source_count:91,component_count:110,mapping_unknown_count:11});
 expect(new Set(p.entries.map(e=>e.source_id)).size).toBe(91);
 expect(p.entries.every(e=>e.source_sha256.length===64&&e.source_cell&&e.question_ids.length)).toBe(true);
 expect(p.summary).toEqual({approved_rule_count:0,unknown_rule_count:110,recorded_rule_count:0});
 expect(p.entries.flatMap(e=>e.components).every(c=>Object.values(c.fields).every(f=>f.status==='unknown'))).toBe(true);
 const weekly=p.entries.find(e=>e.source_id==='AL-W01')!;
 expect(weekly.components[0].fields.schedule.value).toEqual({confirmed_direction:'Weekly generator observation'});
 expect(weekly.components[1].fields.schedule.value).toBeNull();
});
it("uses the same shape at a second site without inheriting first-site facts", () => {
 const p=buildFacilityProfile({...site,id:'22222222-2222-4222-8222-222222222222',name:'Second site',entity_name:'Second entity'},[],[]);
 expect(p.coverage.component_count).toBe(110);expect(p.profile.identity_status).toBe('unconfigured');
 expect(p.entries.find(e=>e.source_id==='AL-W01')!.components[0].fields.schedule.value).toBeNull();
 expect(p.profile.identity_provenance).toEqual([]);
});
it("invalidates identity provenance when current entity or timezone changes", () => {
 expect(buildFacilityProfile({...site,timezone:'UTC'},[],[]).profile.identity_status).toBe('mismatch');
 expect(buildFacilityProfile({...site,entity_id:'22222222-2222-4222-8222-222222222222'},[],[]).entries.find(e=>e.source_id==='AL-W01')!.components[0].fields.schedule.value).toBeNull();
});
it("keeps existing draft pointers visible without representing them as active rules", () => {
 const p=buildFacilityProfile(site,[{id:'draft',facility_id:site.id,activity_id:'e27fce0c-bace-4a06-8a1c-090a56fc8f8e',requirement_version_id:null,status:'draft',effective_from:null,effective_to:null,schedule_status:'confirmed',schedule_rule:{bad:true}}],[]);
 const c=p.entries.find(e=>e.source_id==='AL-W01')!.components[0];expect(c.drafts.status).toBe('existing_drafts');expect(c.configuration_id).toBeNull();expect(c.fields.schedule.status).toBe('unknown');
});
it("preserves publication and approval claims without certifying business approval", () => {
 const activity='e27fce0c-bace-4a06-8a1c-090a56fc8f8e';
 const authority=Object.freeze({source:'Recorded policy v2',answer_id:'Q14-recorded-answer',approver_id:'22222222-2222-4222-8222-222222222222',rule_effective_date:'2026-01-01',exceptions:'Retain this recorded text'});
 const requirement=Object.freeze({id:'requirement',activity_id:activity,version:2,status:'published',effective_from:'2026-07-01T00:00:00Z',effective_to:null,source_authority:authority,published_by:'publication-actor',published_at:'2026-06-30T15:00:00Z',required_evidence:[],allowed_recorder_roles:['facility_admin'],procedure:'Recorded central procedure'});
 const config=Object.freeze({id:'config',activity_id:activity,facility_id:site.id,requirement_version_id:requirement.id,version:3,status:'published',effective_from:'2026-08-01T00:00:00Z',effective_to:null,applicability:'applicable',applicability_reason:'Recorded local scope',override_source:'facility_policy',approved_by:'site-approval-actor',approved_at:'2026-07-30T15:00:00Z',local_procedure:'Recorded site procedure',schedule_status:'needs_confirmation'});
 const before=JSON.stringify({requirement,config});
 const p=buildFacilityProfile(site,[config],[requirement],new Date('2026-09-12T12:00:00Z'));
 const component=p.entries.find(e=>e.source_id==='AL-W01')!.components[0];
 expect(component.publication?.requirement).toMatchObject({version:2,source_authority:authority,published_by:'publication-actor',published_at:'2026-06-30T15:00:00Z',effective_from:'2026-07-01T00:00:00Z'});
 expect(component.publication?.configuration).toMatchObject({version:3,approved_by:'site-approval-actor',approved_at:'2026-07-30T15:00:00Z',effective_from:'2026-08-01T00:00:00Z',applicability_reason:'Recorded local scope'});
 expect(component.fields.evidence.provenance).toContainEqual({source:authority.source,answer_id:authority.answer_id,approver_id:authority.approver_id,effective_from:requirement.effective_from});
 expect(component.fields.procedure.provenance.at(-1)?.approver_id).toBe(config.approved_by);
 expect(component.fields.procedure.status).toBe('recorded');
 expect(p.summary).toEqual({approved_rule_count:0,unknown_rule_count:110,recorded_rule_count:1});
 expect(JSON.stringify({requirement,config})).toBe(before);
});
it("shows an existing central publication before a site configuration is prepared", () => {
 const requirement={id:'central',activity_id:'e27fce0c-bace-4a06-8a1c-090a56fc8f8e',status:'published',effective_from:'2026-01-01T00:00:00Z',effective_to:null,procedure:'Existing central text',published_by:'actor',published_at:'2026-01-01T00:00:00Z',source_authority:{source:'Recorded source'}};
 const p=buildFacilityProfile(site,[],[requirement],new Date('2026-09-12T12:00:00Z'));
 const component=p.entries.find(e=>e.source_id==='AL-W01')!.components[0];
 expect(component.requirement_version_id).toBe('central');
 expect(component.fields.procedure.value).toBe('Existing central text');
 expect(component.publication?.requirement?.published_by).toBe('actor');
 expect(component.configuration_id).toBeNull();
 expect(component.recording.available).toBe(false);
});
it("does not replace a site's recorded central version with a newer publication", () => {
 const activity='e27fce0c-bace-4a06-8a1c-090a56fc8f8e';
 const old={id:'old',activity_id:activity,status:'published',effective_from:'2026-01-01T00:00:00Z',effective_to:'2026-08-01T00:00:00Z',procedure:'Old recorded text'};
 const newer={...old,id:'new',effective_from:'2026-08-01T00:00:00Z',effective_to:null,procedure:'New text'};
 const config={id:'site-version',activity_id:activity,facility_id:site.id,requirement_version_id:'old',status:'published',effective_from:'2026-01-01T00:00:00Z',effective_to:null};
 const p=buildFacilityProfile(site,[config],[newer,old],new Date('2026-09-12T12:00:00Z'));
 const component=p.entries.find(e=>e.source_id==='AL-W01')!.components[0];
 expect(component.requirement_version_id).toBe('old');
 expect(component.publication?.requirement?.effective_to).toBe('2026-08-01T00:00:00Z');
 expect(component.fields.procedure.value).toBe('Old recorded text');
});
const rule:ApprovedProfileRule={facility_id:site.id,activity_id:'e27fce0c-bace-4a06-8a1c-090a56fc8f8e',provenance:{source:'Signed fixture decision',answer_id:'Q14-fixture',approver_id:'22222222-2222-4222-8222-222222222222',effective_from:'2026-09-14T00:00:00Z'},payload:{schedule_status:'needs_confirmation'}};
describe('profile approval provenance validation',()=>{
 it('does not treat complete client claims as server-recorded approval',()=>{expect(validateProfileRuleProposal(rule).valid).toBe(false)});
 it('accepts only the exact independently supplied approved packet',()=>{expect(validateProfileRuleProposal(rule,[rule]).valid).toBe(true)});
 it.each(['facility_id','activity_id','provenance','payload'])('refuses changed %s even with a known answer',key=>{
  const changed={...rule,[key]:key==='provenance'?{...rule.provenance,answer_id:'forged'}:key==='payload'?{schedule_status:'needs_confirmation',owner_role:'owner'}:'33333333-3333-4333-8333-333333333333'};
  expect(validateProfileRuleProposal(changed,[rule]).valid).toBe(false);
 });
 it('requires real source/answer/approver/effective-time fields',()=>{expect(validateProfileRuleProposal({...rule,provenance:{source:'',answer_id:null,approver_id:null,effective_from:null}},[rule]).valid).toBe(false)});
});
