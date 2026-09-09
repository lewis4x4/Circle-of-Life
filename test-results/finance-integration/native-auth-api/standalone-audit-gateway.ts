import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleAuditExport } from "file:///Users/brianlewis/Circle%20of%20Life/Haven%20Finance%20Integration/supabase/functions/export-audit-log/handler.ts";
const api = Deno.env.get("HFA_LOCAL_API_URL")!;
const anon = Deno.env.get("HFA_LOCAL_ANON_KEY")!;
if (api !== "http://127.0.0.1:59831") throw new Error("Run-owned API required");
function filtered(headers: Headers) {
 const result = new Headers(headers);
 for (const key of ["host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) result.delete(key);
 return result;
}
Deno.serve({hostname:"127.0.0.1",port:59835}, async req => {
 const url = new URL(req.url);
 if (url.pathname === "/functions/v1/export-audit-log") return handleAuditExport(req, authorization => createClient(api, anon, {global:{headers:{Authorization:authorization}},auth:{persistSession:false}}));
 if (!url.pathname.startsWith("/auth/v1/") && !url.pathname.startsWith("/rest/v1/")) return new Response("Local route unavailable",{status:404});
 try {
  const headers = filtered(req.headers); headers.set("accept-encoding","identity");
  const response = await fetch(api + url.pathname + url.search,{method:req.method,headers,body:["GET","HEAD"].includes(req.method)?undefined:await req.arrayBuffer(),redirect:"manual"});
  return new Response(response.body,{status:response.status,headers:filtered(response.headers)});
 } catch { return new Response(JSON.stringify({error:"Run-owned gateway unavailable"}),{status:502,headers:{"Content-Type":"application/json"}}); }
});
