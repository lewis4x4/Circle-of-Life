import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
// Execute actual Edge functions without a network or Deno server.
function load(name: string) {
  const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8").replace(/^import .*;$/gm, "");
  const js = ts.transpile(source, {module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022});
  const context = vm.createContext({ Deno: {env: {get: () => "local"}, serve: vi.fn()}, Date, Error, String, Number, Array, JSON });
  vm.runInContext(js, context);
  return context;
}
it("daily note delegates domain insertion and receipt to one transaction", async () => {
  const context = load("grace-execute-flow-step");
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for(const name of ["select","eq","in","is"]) q[name]=vi.fn(()=>q);
  q.single=vi.fn().mockResolvedValue({data:{id:"resident",facility_id:"facility",organization_id:"org"}});
  const rpc=vi.fn().mockResolvedValue({data:{result:{daily_log_id:"saved"},undo_handler:"delete_daily_log"},error:null});
  const admin={from:vi.fn(()=>q),rpc};
  const result=await context.createDailyLog(admin,{user:{id:"actor"},organizationId:"org"},["facility"],{resident_id:"resident"},"run");
  expect(rpc).toHaveBeenCalledWith("commit_grace_action", expect.objectContaining({p_run_id:"run",p_table:"daily_logs"}));
  expect(result.result.daily_log_id).toBe("saved");
});
