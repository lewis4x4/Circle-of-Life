import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ platform: 'google_business', stored: 'Old draft', saveFails: false, finalizeFails: false, serviceClientFails: false, serviceClientError: 'service client failed', saveErrorMessage: 'save failed', credential: {refresh_token:'local-test-token'} as {refresh_token:string}|null, credentialError: null as string|null, updates: [] as Record<string, unknown>[], buildGoogle: vi.fn(), refreshGoogle: vi.fn(), resolveGoogle: vi.fn(), publishGoogle: vi.fn(), publishYelp: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
 auth: { getUser: async () => ({data:{user:{id:'actor'}},error:null}) },
 from: () => {
  let update: Record<string, unknown> | null = null;
  const query = {
   select: () => query, eq: () => query, is: () => query,
   update: (payload: Record<string, unknown>) => { update=payload; state.updates.push(payload); return query; },
   maybeSingle: async () => update ? ((state.saveFails && !('status' in update)) || (state.finalizeFails && 'status' in update) ? {data:null,error:{message:state.saveErrorMessage}} : {data:{id:'reply'},error:null}) : {data:{id:'reply',organization_id:'org',facility_id:'facility',external_review_id:'external',reply_body:state.stored,status:'draft',reputation_accounts:{platform:state.platform,external_place_id:'place',label:'Listing',organization_id:'org'}},error:null},
  }; return query;
 }
}) }));
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => {
 if (state.serviceClientFails) throw new Error(state.serviceClientError);
 return { from: () => { const query = {select:()=>query,eq:()=>query,maybeSingle:async()=>({data:state.credential,error:state.credentialError?{message:state.credentialError}:null})};return query; } };
} }));
vi.mock('@/lib/reputation/google-oauth', () => ({ refreshAccessToken: state.refreshGoogle }));
vi.mock('@/lib/reputation/google-business-reviews', () => ({ GOOGLE_IMPORTED_REPLY_PLACEHOLDER:'placeholder', resolveGoogleLocationParent:state.resolveGoogle, buildGoogleReviewResourceName:state.buildGoogle, putGoogleReviewReply:state.publishGoogle }));
vi.mock('@/lib/reputation/yelp-fusion', () => ({ YELP_IMPORTED_REPLY_PLACEHOLDER:'placeholder' }));
vi.mock('@/lib/reputation/yelp-partner-reviews', () => ({ yelpPartnerReviewPostKey:()=> 'test-configured', postYelpPublicReviewResponse:state.publishYelp }));
vi.mock('@/lib/observability/logger',()=>({logError}));
import { POST as googlePost } from '@/app/api/reputation/replies/[id]/post-google/route';
import { POST as yelpPost } from '@/app/api/reputation/replies/[id]/post-yelp/route';
beforeEach(()=>{state.stored='Old draft';state.saveFails=false;state.finalizeFails=false;state.serviceClientFails=false;state.serviceClientError='service client failed';state.saveErrorMessage='save failed';state.credential={refresh_token:'local-test-token'};state.credentialError=null;state.updates=[];state.buildGoogle.mockReset().mockReturnValue('accounts/a/locations/b/reviews/r');state.refreshGoogle.mockReset().mockResolvedValue({access_token:'test-access'});state.resolveGoogle.mockReset().mockResolvedValue('accounts/a/locations/b');state.publishGoogle.mockReset();state.publishYelp.mockReset();logError.mockReset();});
for (const [platform,post,publish] of [['google_business',googlePost,state.publishGoogle],['yelp',yelpPost,state.publishYelp]] as const) {
 it(`${platform} publishes the visible saved text and not the old draft`, async()=>{
  state.platform=platform;
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  expect(response.status).toBe(200);
  expect(state.updates[0]).toMatchObject({reply_body:'Visible revised draft'});
  expect(publish.mock.calls[0]).toContain('Visible revised draft');
 });
 it(`${platform} never publishes when saving the visible text fails`, async()=>{
  const sentinel='column private_reply_body violates constraint reputation_replies_secret_check';
  state.platform=platform;state.saveFails=true;state.saveErrorMessage=sentinel;
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  const payload=await response.json();
  expect(response.status).toBe(409);expect(payload).toEqual({error:'Draft changed or could not be saved. Reload and review before posting.'});
  expect(JSON.stringify(payload)).not.toContain(sentinel);expect(publish).not.toHaveBeenCalled();
  expect(logError).toHaveBeenCalledWith(expect.stringContaining(platform==='google_business'?'post-google':'post-yelp'),expect.objectContaining({message:sentinel}),{action:'save-draft',replyId:'reply'});
 });
 it(`${platform} rejects a concurrent draft edit before any publication`, async()=>{
  state.platform=platform;state.stored='Another operator edit';
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  expect(response.status).toBe(409); expect(publish).not.toHaveBeenCalled();expect(state.updates).toHaveLength(0);
 });
 it(`${platform} does not expose a provider rejection`,async()=>{
  const sentinel='provider returned secret schema detail for private_review_policy';
  state.platform=platform;publish.mockRejectedValue(new Error(sentinel));
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  const payload=await response.json();
  expect(response.status).toBe(502);expect(JSON.stringify(payload)).not.toContain(sentinel);
  expect(payload.error).toBe(platform==='google_business'?'Google did not accept the reply. Review the connection and retry.':'Yelp did not accept the reply. Review the connection and retry.');
  expect(logError).toHaveBeenCalledWith(expect.stringContaining(platform==='google_business'?'post-google':'post-yelp'),expect.any(Error),{action:'publish',replyId:'reply'});
 });
 it(`${platform} reports the partial publication without exposing the final persistence error`,async()=>{
  const sentinel='relation public.reputation_replies violates constraint private_posted_state';
  state.platform=platform;state.finalizeFails=true;state.saveErrorMessage=sentinel;
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  const payload=await response.json();
  expect(response.status).toBe(500);expect(JSON.stringify(payload)).not.toContain(sentinel);expect(publish).toHaveBeenCalledOnce();
  expect(payload.error).toBe(`Posted to ${platform==='google_business'?'Google':'Yelp'}, but Haven could not record the result. Reconcile the public reply before retrying.`);
 });
}

it('google does not expose an invalid review reference exception',async()=>{
 const sentinel='relation private.google_reviews violates constraint hidden_review_reference';
 state.platform='google_business';state.buildGoogle.mockImplementation(()=>{throw new Error(sentinel);});
 const response=await googlePost(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
 const payload=await response.json();
 expect(response.status).toBe(400);expect(payload).toEqual({error:'Google review reference is invalid. Re-import the review and retry.'});
 expect(JSON.stringify(payload)).not.toContain(sentinel);expect(state.publishGoogle).not.toHaveBeenCalled();
 expect(logError).toHaveBeenCalledWith('reputation.replies.post-google',expect.any(Error),{action:'build-review-reference',replyId:'reply'});
});

it('google logs service-client initialization failure without publishing',async()=>{
 const sentinel='service role bootstrap exposed private credential detail';
 state.platform='google_business';state.serviceClientFails=true;state.serviceClientError=sentinel;
 const response=await googlePost(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
 const payload=await response.json();
 expect(response.status).toBe(503);expect(payload).toEqual({error:'Server configuration error'});
 expect(JSON.stringify(payload)).not.toContain(sentinel);expect(state.publishGoogle).not.toHaveBeenCalled();
 expect(logError).toHaveBeenCalledWith('reputation.replies.post-google',expect.any(Error),{action:'create-service-client',replyId:'reply'});
});

it('google does not expose a credential lookup failure',async()=>{
 const sentinel='credential relation exposed private OAuth storage detail';
 state.platform='google_business';state.credentialError=sentinel;
 const response=await googlePost(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
 const payload=await response.json();
 expect(response.status).toBe(500);expect(payload).toEqual({error:'Google connection status could not be verified. Retry before posting.'});
 expect(JSON.stringify(payload)).not.toContain(sentinel);expect(state.publishGoogle).not.toHaveBeenCalled();
 expect(logError).toHaveBeenCalledWith('reputation.replies.post-google',expect.objectContaining({message:sentinel}),{action:'load-credentials',replyId:'reply'});
});

it('google does not expose a token refresh failure',async()=>{
 const sentinel='OAuth provider returned private client configuration detail';
 state.platform='google_business';state.refreshGoogle.mockRejectedValue(new Error(sentinel));
 const response=await googlePost(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
 const payload=await response.json();
 expect(response.status).toBe(502);expect(payload).toEqual({error:'Google authorization could not be refreshed. Reconnect Google and retry.'});
 expect(JSON.stringify(payload)).not.toContain(sentinel);expect(state.publishGoogle).not.toHaveBeenCalled();
 expect(logError).toHaveBeenCalledWith('reputation.replies.post-google',expect.any(Error),{action:'refresh-token',replyId:'reply'});
});

it('google does not expose a location resolution failure',async()=>{
 const sentinel='location lookup returned private account hierarchy detail';
 state.platform='google_business';state.resolveGoogle.mockRejectedValue(new Error(sentinel));
 const response=await googlePost(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
 const payload=await response.json();
 expect(response.status).toBe(502);expect(payload).toEqual({error:'Google Business location could not be verified. Retry before posting.'});
 expect(JSON.stringify(payload)).not.toContain(sentinel);expect(state.publishGoogle).not.toHaveBeenCalled();
 expect(logError).toHaveBeenCalledWith('reputation.replies.post-google',expect.any(Error),{action:'resolve-location',replyId:'reply'});
});
