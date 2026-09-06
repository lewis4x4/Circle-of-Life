import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({access:true,rpc:vi.fn(),actorId:'manager-session',organizationId:'org',meetingOrg:'org'}));
vi.mock('@/lib/admin/api-auth',()=>({
 requireAdminApiActor: async()=>({actor:{id:state.actorId,organization_id:state.organizationId,app_role:'manager',admin:{
  from:()=>{const query={select:()=>query,eq:()=>query,is:()=>query,maybeSingle:async()=>({data:{facility_id:'facility',organization_id:state.meetingOrg},error:null})};return query;},rpc:state.rpc,
 }}}),
 actorCanAccessFacility:async()=>state.access,
}));
import { POST } from './route';
const body={id:'11111111-1111-4111-8111-111111111111',description:'Call supplier',assigned_to:null,due_date:'2026-09-07'};
beforeEach(()=>{state.access=true;state.meetingOrg='org';state.rpc.mockReset().mockResolvedValue({data:body.id,error:null});});
it('creates a meeting action using the authenticated manager identity',async()=>{
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({id:body.id});
 expect(state.rpc).toHaveBeenCalledWith('create_meeting_action',expect.objectContaining({p_actor_id:'manager-session',p_meeting_id:'meeting'}));
});
it('refuses a manager without access to the meeting facility',async()=>{
 state.access=false;const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(403);expect(state.rpc).not.toHaveBeenCalled();
});
it('rejects caller-supplied actor identity instead of forwarding it',async()=>{
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify({...body,actor_id:'someone-else'})}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
});
