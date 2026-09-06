import {expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {fetchFamilyBillingContext} from "./family-billing-data";
import {fetchFamilyMessagesForResident} from "./family-messages-data";

it("does not double-count an invoice when a new invoice shifts later pages",async()=>{
 const invoice=(n:number)=>({id:String(n).padStart(5,"0"),resident_id:"resident",invoice_number:String(n),invoice_date:"2026-09-01",due_date:"2026-09-30",period_start:"2026-09-01",period_end:"2026-09-30",total:100,balance_due:100,status:"sent"});
 const first=Array.from({length:500},(_,i)=>invoice(501-i));let reads=0;
 const client={auth:{getUser:async()=>({data:{user:{id:"family"}},error:null})},from:(table:string)=>{
  const q:Record<string,ReturnType<typeof vi.fn>>={};let cursor=false;
  for(const method of ["select","is","order","range","limit","in"])q[method]=vi.fn(()=>q);
  q.lt=vi.fn(()=>{cursor=true;return q;});
  q.then=vi.fn((resolve)=>resolve({data:table==="invoices"?(reads++===0?first:cursor?[invoice(1)]:[invoice(2),invoice(1)]):table==="residents"?[{id:"resident",first_name:"Test",last_name:"Resident"}]:[],error:null}));
  return q;
 }} as unknown as SupabaseClient<Database>;
 const result=await fetchFamilyBillingContext(client);expect(result.ok).toBe(true);
 if(result.ok){expect(result.data.invoices).toHaveLength(501);expect(result.data.totalBalanceDue).toBe(50100);}
});

it("loads older messages after a stable timestamp/id anchor",async()=>{
 const q:Record<string,ReturnType<typeof vi.fn>>={};let keyset=false;
 for(const method of ["select","eq","is","order","range","limit"])q[method]=vi.fn(()=>q);
 q.or=vi.fn(()=>{keyset=true;return q;});
 q.then=vi.fn((resolve)=>resolve({data:[{id:keyset?"older":"already-shown",resident_id:"resident",body:"Update",created_at:"2026-09-01T12:00:00Z",author_kind:"staff"}],error:null}));
 const client={from:()=>q} as unknown as SupabaseClient<Database>;
 const result=await fetchFamilyMessagesForResident(client,"resident",{createdAt:"2026-09-02T12:00:00Z",id:"11111111-1111-4111-8111-111111111111"});
 expect(result.ok && result.messages[0].id).toBe("older");
});
