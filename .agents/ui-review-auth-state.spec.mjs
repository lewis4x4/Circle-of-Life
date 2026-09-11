import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const exec=promisify(execFile),repo=process.cwd();
test('both UI runners use explicit state; anonymous defaults still reject protected-route redirects',async()=>{
 const runId='ui-review-auth-state-'+randomUUID(),root=path.join(homedir(),'.hermes/tmp/agent-runs',runId);await mkdir(root,{recursive:true,mode:0o700});
 const manifest={created_by:'codex',run_id:runId,root,purpose:'Synthetic cookie plumbing tests for UI gate runners; not application authentication proof',paths:[]};
 const collect=async(dir)=>{const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await collect(file));else result.push(file);}return result;};
 const server=createServer((req,res)=>{if(req.url!=='/login'&&!req.headers.cookie?.includes('ui-review-fixture=allowed')){res.writeHead(302,{Location:'/login'});res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><head><title>UI gate fixture</title></head><body><main><h1>Private fixture</h1></main></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const state=path.join(root,'fixture-state.json');await writeFile(state,JSON.stringify({cookies:[{name:'ui-review-fixture',value:'allowed',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}),{mode:0o600});
 try{
  for(const script of ['.agents/design-review-runner.mjs','scripts/a11y-axe-routes.mjs']){
   const env={...process.env,BASE_URL:base,DESIGN_REVIEW_ROUTES:'/admin/stand-up',AXE_ROUTES:'/admin/stand-up',UI_REVIEW_STORAGE_STATE:state,UI_REVIEW_READY_SELECTOR:'main h1'};
   const passed=await exec(process.execPath,[path.join(repo,script)],{cwd:root,env,timeout:60000,maxBuffer:1024*1024});assert.match(passed.stdout,/PASS/);
   const anonymous={...env};delete anonymous.UI_REVIEW_STORAGE_STATE;
   let anonymousError;try{await exec(process.execPath,[path.join(repo,script)],{cwd:root,env:anonymous,timeout:60000,maxBuffer:1024*1024});}catch(error){anonymousError=error;}
   assert.equal(anonymousError?.code,1,'default anonymous browser must not substitute login for the requested route');
   if(script.startsWith('.agents/')){const report=JSON.parse(await readFile(path.join(root,'test-results/design-review/report.json'),'utf8'));assert.equal(report.authentication,'anonymous');assert.equal(report.shots.length,0);assert(report.errors.every(error=>/Authentication required/.test(error.message)));}
   else assert.match(anonymousError.stderr,/Authentication required/);
   await assert.rejects(exec(process.execPath,[path.join(repo,script)],{cwd:root,env:{...env,UI_REVIEW_STORAGE_STATE:path.join(root,'missing-state.json')},timeout:60000,maxBuffer:1024*1024}),error=>error.code===1&&/ENOENT/.test(error.stderr),'invalid state must fail rather than silently use anonymous access');
  }
 }finally{await new Promise(resolve=>server.close(resolve));manifest.paths=await collect(root);await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});console.log('Owned UI plumbing evidence: '+root);}
});
