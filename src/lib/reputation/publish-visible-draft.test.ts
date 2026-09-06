import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ platform: 'google_business', stored: 'Old draft', saveFails: false, updates: [] as Record<string, unknown>[], publishGoogle: vi.fn(), publishYelp: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
 auth: { getUser: async () => ({data:{user:{id:'actor'}},error:null}) },
 from: () => {
  let update: Record<string, unknown> | null = null;
  const query = {
   select: () => query, eq: () => query, is: () => query,
   update: (payload: Record<string, unknown>) => { update=payload; state.updates.push(payload); return query; },
   maybeSingle: async () => update ? (state.saveFails ? {data:null,error:{message:'save failed'}} : {data:{id:'reply'},error:null}) : {data:{id:'reply',organization_id:'org',facility_id:'facility',external_review_id:'external',reply_body:state.stored,status:'draft',reputation_accounts:{platform:state.platform,external_place_id:'place',label:'Listing',organization_id:'org'}},error:null},
  }; return query;
 }
}) }));
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => ({ from: () => { const query = {select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{refresh_token:'local-test-token'},error:null})};return query; } }) }));
vi.mock('@/lib/reputation/google-oauth', () => ({ refreshAccessToken: async () => ({access_token:'test-access'}) }));
vi.mock('@/lib/reputation/google-business-reviews', () => ({ GOOGLE_IMPORTED_REPLY_PLACEHOLDER:'placeholder', resolveGoogleLocationParent:async()=> 'accounts/a/locations/b', buildGoogleReviewResourceName:()=> 'accounts/a/locations/b/reviews/r', putGoogleReviewReply:state.publishGoogle }));
vi.mock('@/lib/reputation/yelp-fusion', () => ({ YELP_IMPORTED_REPLY_PLACEHOLDER:'placeholder' }));
vi.mock('@/lib/reputation/yelp-partner-reviews', () => ({ yelpPartnerReviewPostKey:()=> 'test-configured', postYelpPublicReviewResponse:state.publishYelp }));
import { POST as googlePost } from '@/app/api/reputation/replies/[id]/post-google/route';
import { POST as yelpPost } from '@/app/api/reputation/replies/[id]/post-yelp/route';
beforeEach(()=>{state.stored='Old draft';state.saveFails=false;state.updates=[];state.publishGoogle.mockReset();state.publishYelp.mockReset();});
for (const [platform,post,publish] of [['google_business',googlePost,state.publishGoogle],['yelp',yelpPost,state.publishYelp]] as const) {
 it(`${platform} publishes the visible saved text and not the old draft`, async()=>{
  state.platform=platform;
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  expect(response.status).toBe(200);
  expect(state.updates[0]).toMatchObject({reply_body:'Visible revised draft'});
  expect(publish.mock.calls[0]).toContain('Visible revised draft');
 });
 it(`${platform} never publishes when saving the visible text fails`, async()=>{
  state.platform=platform;state.saveFails=true;
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  expect(response.status).toBe(409); expect(publish).not.toHaveBeenCalled();
 });
 it(`${platform} rejects a concurrent draft edit before any publication`, async()=>{
  state.platform=platform;state.stored='Another operator edit';
  const response=await post(new Request('https://local.test/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_body:'Visible revised draft',expected_reply_body:'Old draft'})}),{params:Promise.resolve({id:'reply'})});
  expect(response.status).toBe(409); expect(publish).not.toHaveBeenCalled();expect(state.updates).toHaveLength(0);
 });
}
