import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { supabaseStore } from "./store.ts";

Deno.test("notification claims are drained and outcome retry fields reach the correct SQL writer", async () => {
  const calls: Array<{name:string; args:Record<string,unknown>}> = [];
  const admin = { rpc(name:string,args:Record<string,unknown>) {
    calls.push({name,args});
    return Promise.resolve({error:null,data:name === "claim_observation_escalation_deliveries" ? [] :
      name === "claim_smart_rounding_notifications" ? [{id:"notification",source:"watchlist",channel:"push"}] : true});
  } };
  const store = supabaseStore(admin as never);
  const deliveries = await store.claimDeliveries("organization","facility","claim","2026-09-19T12:00:00Z",20);
  assertEquals(deliveries[0].notification_source,"watchlist");
  await store.recordDeliveryOutcome("notification","claim",{status:"failed",retryable:true,retry_after_seconds:90});
  assertEquals(calls[1].args.p_organization_id,"organization");
  assertEquals(calls[1].args.p_facility_id,"facility");
  assertEquals(calls[2].name,"record_smart_rounding_notification_outcome");
  assertEquals(calls[2].args.p_source,"watchlist");
  assertEquals(calls[2].args.p_retryable,true);
  assertEquals(calls[2].args.p_retry_after_seconds,90);
});

Deno.test("a failed ancillary queue claim never abandons already claimed escalations", async () => {
  const admin = {rpc(name:string) { return Promise.resolve(name === "claim_observation_escalation_deliveries"
    ? {data:[{id:"urgent"}],error:null} : {data:null,error:{code:"XX000"}}); }};
  const store = supabaseStore(admin as never);
  assertEquals((await store.claimDeliveries("org","facility","claim","2026-09-19T12:00:00Z",20))[0].id,"urgent");
  assertEquals(store.takeClaimFailures?.(),1);
});
