import { beforeEach, expect, it, vi } from 'vitest';
// COL-133 revokes create_meeting_action until a classified meeting-task command
// exists. The route must say so before touching the meeting or the RPC. The
// former success-path tests live in history (afe24111) for when the command ships.
const state=vi.hoisted(()=>({access:true,rpc:vi.fn(),from:vi.fn(),actorId:'manager-session',organizationId:'org',meetingOrg:'org'}));
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/operations/auth',()=>({
 requireOperationsActor: async()=>({actor:{id:state.actorId,organizationId:state.organizationId,appRole:'manager',currentActor:{client:{
  from:state.from,rpc:state.rpc,
 }}}}),
 actorCanAccessFacility:async()=>state.access,
}));
vi.mock('@/lib/observability/logger',()=>({logError}));
import { POST } from './route';
const body={id:'11111111-1111-4111-8111-111111111111',description:'Call supplier',assigned_to:null,due_date:'2026-09-07'};
beforeEach(()=>{state.access=true;state.meetingOrg='org';state.rpc.mockReset();state.from.mockReset();logError.mockReset();});
it('reports meeting task creation as unavailable without reading the meeting or calling the revoked command',async()=>{
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(409);
 expect(await response.json()).toEqual({error:'Meeting task creation requires a classified command and is not available yet'});
 expect(state.from).not.toHaveBeenCalled();
 expect(state.rpc).not.toHaveBeenCalled();
 expect(logError).not.toHaveBeenCalled();
});
it('does not reveal whether a meeting exists or is accessible while the command is unavailable',async()=>{
 state.access=false;state.meetingOrg='other-org';
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'missing-meeting'})});
 expect(response.status).toBe(409);
 expect(state.from).not.toHaveBeenCalled();
 expect(state.rpc).not.toHaveBeenCalled();
});
it('still validates the request shape and rejects caller-supplied actor identity',async()=>{
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:JSON.stringify({...body,actor_id:'someone-else'})}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
});
it('rejects a malformed body before anything else',async()=>{
 const response=await POST(new Request('https://local.test/actions',{method:'POST',body:'not json'}),{params:Promise.resolve({id:'meeting'})});
 expect(response.status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
});
